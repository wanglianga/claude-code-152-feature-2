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
import { DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { Order } from '../entities/order.entity';
import { Item } from '../entities/item.entity';
import { Consignment } from '../entities/consignment.entity';
import { Delivery } from '../entities/delivery.entity';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt.guard';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';

class CreateOrderDto {
  itemId: string;
  buyerAddress: string;
  buyerFloor: number;
  buyerElevator: string;
  needOldFurnitureRemoval?: boolean;
  appointmentWindow?: string;
  dealPrice?: number;
}

/** 配送费估价：基础 60 + 无电梯每层 15 + 旧家具搬出 80，自提（半径 0）为 0 */
export function estimateDeliveryFee(item: Item, dto: CreateOrderDto) {
  if (item.deliveryRadiusKm === 0) return 0;
  let fee = 60;
  const noElevator =
    dto.buyerElevator === 'NO_ELEVATOR' || dto.buyerElevator === 'WALKUP';
  if (noElevator) fee += Math.max(0, Number(dto.buyerFloor) - 1) * 15;
  if (dto.needOldFurnitureRemoval) fee += 80;
  return fee;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('orders')
export class OrderController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** 买家下单：锁定商品，生成订单与待安排配送任务 */
  @Roles('BUYER')
  @Post()
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateOrderDto,
  ) {
    return this.ds.transaction(async (m) => {
      const item = await m.findOne(Item, { where: { id: dto.itemId } });
      if (!item) throw new NotFoundException('商品不存在');
      if (item.status !== 'LISTED') {
        throw new BadRequestException(`商品当前 ${item.status}，不可下单`);
      }
      const consignment = await m.findOne(Consignment, {
        where: { id: item.consignmentId },
      });
      if (!consignment) throw new NotFoundException('寄卖信息缺失');
      if (consignment.sellerId === user.sub) {
        throw new BadRequestException('不能购买自己寄卖的商品');
      }

      const dealPrice = Number(dto.dealPrice ?? item.listedPrice);
      if (dealPrice < Number(item.minDealPrice)) {
        throw new BadRequestException(
          `出价 ${dealPrice} 低于最低成交价 ${item.minDealPrice}`,
        );
      }

      const count = await m.count(Order);
      const order = m.create(Order, {
        code: `OD${new Date().getFullYear()}${String(count + 1).padStart(6, '0')}`,
        itemId: item.id,
        consignmentId: consignment.id,
        buyerId: user.sub,
        sellerId: consignment.sellerId,
        dealPrice: dealPrice.toFixed(2),
        deliveryFee: '0',
        buyerAddress: dto.buyerAddress || '',
        buyerFloor: Number(dto.buyerFloor) || 1,
        buyerElevator: dto.buyerElevator || 'ELEVATOR',
        needOldFurnitureRemoval: !!dto.needOldFurnitureRemoval,
        appointmentWindow: dto.appointmentWindow || '',
        status: 'CREATED',
      });
      order.deliveryFee = estimateDeliveryFee(item, dto).toFixed(2);
      await m.save(order);

      const delivery = m.create(Delivery, {
        orderId: order.id,
        vehicleType: 'SMALL_VAN',
        needsDisassembly: consignment.disassemblable,
        oldFurnitureRemoval: order.needOldFurnitureRemoval,
        pickupFloor: consignment.floor,
        pickupElevator: consignment.elevator,
        dropoffFloor: order.buyerFloor,
        dropoffElevator: order.buyerElevator,
        scheduledWindow: order.appointmentWindow,
        status: 'PENDING',
      });
      await m.save(delivery);

      item.status = 'RESERVED';
      await m.save(item);
      return { order, delivery };
    });
  }

  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    const repo = this.ds.getRepository(Order);
    const where: any =
      user.role === 'BUYER'
        ? { buyerId: user.sub }
        : user.role === 'SELLER'
          ? { sellerId: user.sub }
          : {};
    return repo.find({ where, order: { createdAt: 'DESC' } });
  }

  @Get(':id')
  async detail(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const order = await this.ds.getRepository(Order).findOne({
      where: { id },
    });
    if (!order) throw new NotFoundException('订单不存在');
    if (
      (user.role === 'BUYER' && order.buyerId !== user.sub) ||
      (user.role === 'SELLER' && order.sellerId !== user.sub)
    ) {
      throw new ForbiddenException('无权查看该订单');
    }
    const delivery = await this.ds.getRepository(Delivery).findOne({
      where: { orderId: id },
    });
    let item = await this.ds.getRepository(Item).findOne({
      where: { id: order.itemId },
    });
    // 买家只看翻新后对外状态，内部审计旧照片/已确认超预算额度不下发
    if (item && user.role === 'BUYER') {
      const { archivedInternalPhotos, approvedOverrunCost, ...pub }: any = item;
      item = pub;
    }
    return { order, delivery, item };
  }

  /** 买家在配送排班前取消订单，商品重新上架 */
  @Roles('BUYER')
  @Post(':id/cancel')
  async cancel(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.ds.transaction(async (m) => {
      const order = await m.findOne(Order, { where: { id } });
      if (!order) throw new NotFoundException('订单不存在');
      if (order.buyerId !== user.sub) throw new ForbiddenException();
      if (!['CREATED'].includes(order.status)) {
        throw new BadRequestException('已排班/配送中的订单请走售后工单');
      }
      order.status = 'CANCELLED';
      await m.save(order);
      const item = await m.findOne(Item, { where: { id: order.itemId } });
      if (item) {
        item.status = 'LISTED';
        await m.save(item);
      }
      return order;
    });
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Order, Item, Consignment, Delivery])],
  controllers: [OrderController],
})
export class OrderModule {}
