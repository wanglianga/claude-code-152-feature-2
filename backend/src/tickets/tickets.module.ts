import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { Ticket, TicketMessage, TicketType } from '../entities/ticket.entity';
import { Consignment } from '../entities/consignment.entity';
import { Item } from '../entities/item.entity';
import { Order } from '../entities/order.entity';
import { Delivery } from '../entities/delivery.entity';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt.guard';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SellerRiskService } from '../risk/risk.module';

const TICKET_TYPES: TicketType[] = [
  'SELLER_BACKTRACK',
  'APPRAISAL_MISMATCH',
  'REFURBISH_OVERRUN',
  'COLOR_DIFFERENCE',
  'ELEVATOR_BLOCK',
  'TRANSIT_DAMAGE',
  'RETURN_REQUEST',
  'OTHER',
];

class CreateTicketDto {
  consignmentId?: string;
  itemId?: string;
  orderId?: string;
  type: TicketType;
  title: string;
  description: string;
}

class ResolveDto {
  resolution:
    | 'KEEP_LISTING'
    | 'REDUCE_PRICE'
    | 'SELLER_COMPENSATE'
    | 'PLATFORM_COMPENSATE'
    | 'RETURN_REFUND'
    | 'RE_LIST'
    | 'CANCEL_CONSIGNMENT';
  liableParty: 'SELLER' | 'BUYER' | 'PLATFORM' | 'DELIVERY' | 'REFURBISHER' | 'SHARED';
  compensationAmount?: number;
  note?: string;
  newPrice?: number;
}

/**
 * 协同工单：卖家、买家、仓库、翻新师、配送、客服围绕同一件家具处理异常。
 * 客服可给出处理结论并触发订单/商品/寄卖状态联动，结论与赔付金额进入结算来源。
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tickets')
export class TicketController {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly risk: SellerRiskService,
  ) {}

  @Post()
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateTicketDto,
  ) {
    if (!TICKET_TYPES.includes(dto.type)) {
      throw new BadRequestException('未知工单类型');
    }
    if (!dto.title || !dto.description) {
      throw new BadRequestException('请填写工单标题与描述');
    }
    return this.ds.transaction(async (m) => {
      let consignmentId = dto.consignmentId;
      let itemId = dto.itemId || null;
      let orderId = dto.orderId || null;

      if (orderId) {
        const order = await m.findOne(Order, { where: { id: orderId } });
        if (!order) throw new NotFoundException('关联订单不存在');
        if (
          user.role === 'BUYER' &&
          order.buyerId !== user.sub
        ) {
          throw new ForbiddenException('只能为自己的订单发起工单');
        }
        if (user.role === 'SELLER' && order.sellerId !== user.sub) {
          throw new ForbiddenException('只能为自己的订单发起工单');
        }
        consignmentId = order.consignmentId;
        itemId = order.itemId;
      } else if (itemId) {
        const item = await m.findOne(Item, { where: { id: itemId } });
        if (!item) throw new NotFoundException('关联商品不存在');
        consignmentId = item.consignmentId;
      }
      if (!consignmentId) {
        throw new BadRequestException('工单必须关联家具（寄卖单/商品/订单）');
      }
      const consignment = await m.findOne(Consignment, {
        where: { id: consignmentId },
      });
      if (!consignment) throw new NotFoundException('寄卖单不存在');
      if (user.role === 'SELLER' && consignment.sellerId !== user.sub) {
        throw new ForbiddenException('只能为自己的寄卖发起工单');
      }

      const ticket = m.create(Ticket, {
        consignmentId,
        itemId,
        orderId,
        type: dto.type,
        createdBy: user.sub,
        creatorRole: user.role,
        status: 'OPEN',
        resolution: 'PENDING',
        liableParty: 'SHARED',
        title: dto.title,
        description: dto.description,
      });
      await m.save(ticket);

      // 卖家临时反悔/描述不符工单即时留下画像痕迹（处理完结时再重算）
      if (
        user.role === 'SELLER' &&
        ['SELLER_BACKTRACK', 'APPRAISAL_MISMATCH'].includes(dto.type)
      ) {
        await this.risk.recalculate(consignment.sellerId);
      }
      return this.buildDetail(m, ticket.id, user);
    });
  }

  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    const repo = this.ds.getRepository(Ticket);
    let tickets: Ticket[];
    if (['CS', 'OPS', 'ADMIN', 'APPRAISER', 'WAREHOUSE', 'REFURBISHER', 'DELIVERY'].includes(user.role)) {
      tickets = await repo.find({ order: { createdAt: 'DESC' } });
    } else if (user.role === 'SELLER') {
      const consignments = await this.ds.getRepository(Consignment).find({
        where: { sellerId: user.sub },
      });
      const ids = consignments.map((c) => c.id);
      tickets = ids.length
        ? await repo.find({
            where: { consignmentId: In(ids) },
            order: { createdAt: 'DESC' },
          })
        : [];
    } else {
      const orders = await this.ds.getRepository(Order).find({
        where: { buyerId: user.sub },
      });
      const ids = orders.map((o) => o.id);
      tickets = ids.length
        ? await repo.find({
            where: { orderId: In(ids) },
            order: { createdAt: 'DESC' },
          })
        : [];
    }
    return tickets;
  }

  @Get(':id')
  async detail(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.buildDetail(this.ds.manager, id, user, true);
  }

  /** 各方在同一工单下协同留言 */
  @Post(':id/messages')
  async message(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { content: string },
  ) {
    if (!body?.content?.trim()) {
      throw new BadRequestException('留言内容不能为空');
    }
    const ticket = await this.ds.getRepository(Ticket).findOne({ where: { id } });
    if (!ticket) throw new NotFoundException('工单不存在');
    await this.assertVisible(user, ticket);
    const msg = this.ds.getRepository(TicketMessage).create({
      ticketId: id,
      authorId: user.sub,
      authorRole: user.role,
      authorName: user.name,
      content: body.content.trim(),
    });
    await this.ds.getRepository(TicketMessage).save(msg);
    return msg;
  }

  /** 客服裁定处理结论，联动订单/商品/寄卖单状态；赔付金额写入工单供结算引用 */
  @Roles('CS', 'OPS', 'ADMIN')
  @Post(':id/resolve')
  async resolve(
    @Param('id') id: string,
    @Body() dto: ResolveDto,
  ) {
    const validResolutions = [
      'KEEP_LISTING',
      'REDUCE_PRICE',
      'SELLER_COMPENSATE',
      'PLATFORM_COMPENSATE',
      'RETURN_REFUND',
      'RE_LIST',
      'CANCEL_CONSIGNMENT',
    ];
    if (!validResolutions.includes(dto.resolution)) {
      throw new BadRequestException('未知处理结论');
    }
    return this.ds.transaction(async (m) => {
      const ticket = await m.findOne(Ticket, { where: { id } });
      if (!ticket) throw new NotFoundException('工单不存在');
      if (ticket.status === 'CLOSED') {
        throw new BadRequestException('工单已关闭');
      }
      ticket.resolution = dto.resolution;
      ticket.liableParty = dto.liableParty;
      ticket.compensationAmount = String(Number(dto.compensationAmount || 0));
      ticket.status = 'RESOLVED';
      await m.save(ticket);

      if (dto.note) {
        await m.save(
          m.create(TicketMessage, {
            ticketId: ticket.id,
            authorId: ticket.createdBy,
            authorRole: 'CS',
            authorName: '客服裁定',
            content: `【处理结论】${dto.note}（责任方：${dto.liableParty}，赔付：¥${ticket.compensationAmount}）`,
          }),
        );
      }

      const item = ticket.itemId
        ? await m.findOne(Item, { where: { id: ticket.itemId } })
        : null;
      const order = ticket.orderId
        ? await m.findOne(Order, { where: { id: ticket.orderId } })
        : null;
      const consignment = await m.findOne(Consignment, {
        where: { id: ticket.consignmentId },
      });
      const delivery = order
        ? await m.findOne(Delivery, { where: { orderId: order.id } })
        : null;

      switch (dto.resolution) {
        case 'CANCEL_CONSIGNMENT':
          if (consignment) {
            consignment.status = 'CANCELLED';
            await m.save(consignment);
          }
          if (order && !['DELIVERED', 'SETTLED'].includes(order.status)) {
            order.status = 'CANCELLED';
            await m.save(order);
          }
          if (item) {
            item.status = 'OFF_SHELF';
            await m.save(item);
          }
          break;
        case 'RETURN_REFUND':
          if (order) {
            order.status =
              order.status === 'DELIVERED' || order.status === 'SETTLED'
                ? 'RETURNED'
                : 'RETURNING';
            await m.save(order);
          }
          if (item) {
            item.status = 'RETURNED';
            await m.save(item);
          }
          if (delivery && delivery.status !== 'DONE') {
            delivery.status = 'FAILED';
            delivery.failReason =
              ticket.type === 'ELEVATOR_BLOCK'
                ? 'ELEVATOR_TOO_SMALL'
                : delivery.failReason;
            await m.save(delivery);
          }
          break;
        case 'REDUCE_PRICE':
          if (item && dto.newPrice && Number(dto.newPrice) > 0) {
            item.listedPrice = Number(dto.newPrice).toFixed(2);
            if (
              Number(item.minDealPrice) > Number(dto.newPrice)
            ) {
              item.minDealPrice = Number(dto.newPrice).toFixed(2);
            }
            await m.save(item);
          }
          if (order && dto.newPrice && Number(dto.newPrice) > 0) {
            order.dealPrice = Number(dto.newPrice).toFixed(2);
            await m.save(order);
          }
          break;
        case 'RE_LIST':
          if (item && ['RETURNED', 'RESERVED'].includes(item.status)) {
            item.status = 'LISTED';
            await m.save(item);
          }
          if (order && order.status === 'RETURNING') {
            order.status = 'CANCELLED';
            await m.save(order);
          }
          break;
        case 'KEEP_LISTING':
          if (item && item.status === 'RESERVED' && !order) {
            item.status = 'LISTED';
            await m.save(item);
          }
          break;
      }

      if (consignment) {
        await this.risk.recalculate(consignment.sellerId);
      }
      return this.buildDetail(m, ticket.id, null);
    });
  }

  private async assertVisible(user: JwtPayload, ticket: Ticket) {
    if (['CS', 'OPS', 'ADMIN', 'APPRAISER', 'WAREHOUSE', 'REFURBISHER', 'DELIVERY'].includes(user.role)) {
      return;
    }
    if (user.role === 'SELLER') {
      const c = await this.ds.getRepository(Consignment).findOne({
        where: { id: ticket.consignmentId },
      });
      if (c?.sellerId === user.sub) return;
    }
    if (user.role === 'BUYER' && ticket.orderId) {
      const o = await this.ds.getRepository(Order).findOne({
        where: { id: ticket.orderId },
      });
      if (o?.buyerId === user.sub) return;
    }
    throw new ForbiddenException('无权查看该工单');
  }

  private async buildDetail(
    manager: DataSource['manager'] | DataSource,
    ticketId: string,
    user: JwtPayload | null,
    checkAccess = false,
  ) {
    const m: any = manager;
    const ticket = await m.findOne(Ticket, { where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('工单不存在');
    if (checkAccess && user) await this.assertVisible(user, ticket);
    const messages = await m.find(TicketMessage, {
      where: { ticketId },
      order: { createdAt: 'ASC' },
    });
    const consignment = await m.findOne(Consignment, {
      where: { id: ticket.consignmentId },
    });
    const item = ticket.itemId
      ? await m.findOne(Item, { where: { id: ticket.itemId } })
      : null;
    const order = ticket.orderId
      ? await m.findOne(Order, { where: { id: ticket.orderId } })
      : null;
    const delivery = order
      ? await m.findOne(Delivery, { where: { orderId: order.id } })
      : null;
    const isBuyer = user?.role === 'BUYER';
    return {
      ticket,
      messages,
      // 买家侧屏蔽翻新前旧瑕疵照片与内部审计归档
      consignment:
        consignment && isBuyer
          ? { ...consignment, defectPhotos: [] }
          : consignment,
      item:
        item && isBuyer
          ? (() => {
              const { archivedInternalPhotos, approvedOverrunCost, ...pub }: any = item;
              return pub;
            })()
          : item,
      order,
      delivery,
    };
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Ticket,
      TicketMessage,
      Consignment,
      Item,
      Order,
      Delivery,
    ]),
  ],
  controllers: [TicketController],
})
export class TicketModule {}
