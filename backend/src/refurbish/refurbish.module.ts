import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  RefurbishOverrunConfirmation,
  OverrunStatus,
} from '../entities/refurbish-confirmation.entity';
import { Item, ItemWorkLog } from '../entities/item.entity';
import { Consignment } from '../entities/consignment.entity';
import { Appraisal } from '../entities/appraisal.entity';
import { User } from '../entities/user.entity';
import { Ticket } from '../entities/ticket.entity';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt.guard';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';

/** 平台内部角色：可见估价偏差原因与旧照片等审计信息 */
export const INTERNAL_ROLES = [
  'WAREHOUSE',
  'REFURBISHER',
  'CS',
  'OPS',
  'ADMIN',
  'APPRAISER',
  'DELIVERY',
];

class CreateOverrunDto {
  reason: string;
  additionalLaborCost: number;
  additionalMaterialCost: number;
  revisedListedPrice: number;
  affectListing: boolean;
  listingDelayDays?: number;
  beforePhotos?: string[];
  /** 估价偏差原因（内部考核用，不对卖家展示） */
  deviationReason?: string;
}

class DecisionDto {
  decision: 'ACCEPT' | 'REJECT_REDUCE' | 'REJECT_CANCEL';
  note?: string;
  /** 拒绝并选择降价上架时的新挂牌价 */
  reducedPrice?: number;
}

/** 卖家视角脱敏：估价偏差原因仅平台内部保留用于考核估价师 */
export function sanitizeOverrun(
  o: RefurbishOverrunConfirmation,
  role: string,
): RefurbishOverrunConfirmation {
  if (INTERNAL_ROLES.includes(role)) return o;
  return { ...o, deviationReason: '' };
}

/**
 * 翻新成本超预算确认：
 * 仓库清洁发现瑕疵比估价时严重 → 平台把新增工时/材料费、预计售价变化、
 * 是否影响上架时间推给卖家确认；接受则追加翻新费（成交款扣除），
 * 拒绝则降价上架或取消寄卖；估价偏差原因留档考核估价师。
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('refurbish')
export class RefurbishController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** 仓库/翻新师发起超预算确认 */
  @Roles('WAREHOUSE', 'REFURBISHER', 'OPS', 'ADMIN')
  @Post('items/:itemId/overrun')
  async create(
    @CurrentUser() user: JwtPayload,
    @Param('itemId') itemId: string,
    @Body() dto: CreateOverrunDto,
  ) {
    const labor = Number(dto.additionalLaborCost || 0);
    const material = Number(dto.additionalMaterialCost || 0);
    const revised = Number(dto.revisedListedPrice || 0);
    if (!dto.reason?.trim()) {
      throw new BadRequestException('请说明清洁时发现的新瑕疵与需要追加的作业');
    }
    if (!(labor >= 0) || !(material >= 0) || labor + material <= 0) {
      throw new BadRequestException('新增工时费与材料费之和必须大于 0');
    }
    if (!(revised > 0)) {
      throw new BadRequestException('请填写翻新后的预计售价');
    }
    const delayDays = Math.max(0, Number(dto.listingDelayDays || 0));
    if (dto.affectListing && delayDays === 0) {
      throw new BadRequestException('影响上架时间时请填写预计延后天数');
    }

    return this.ds.transaction(async (m) => {
      const item = await m.findOne(Item, { where: { id: itemId } });
      if (!item) throw new NotFoundException('商品不存在');
      if (!['PREPARING', 'PHOTOGRAPHY'].includes(item.status)) {
        throw new BadRequestException(
          `商品当前 ${item.status}，仅清洁翻新/拍照阶段可发起超预算确认`,
        );
      }
      const pending = await m.count(RefurbishOverrunConfirmation, {
        where: { itemId, status: 'PENDING' },
      });
      if (pending > 0) {
        throw new BadRequestException('该商品已有待卖家确认的超预算确认单');
      }
      const consignment = await m.findOne(Consignment, {
        where: { id: item.consignmentId },
      });
      if (!consignment) throw new NotFoundException('寄卖单不存在');
      const appraisal = await m.findOne(Appraisal, {
        where: { consignmentId: consignment.id },
      });
      if (!appraisal) throw new NotFoundException('估价单缺失，无法比对预估成本');

      const count = await m.count(RefurbishOverrunConfirmation);
      const overrun = m.create(RefurbishOverrunConfirmation, {
        code: `OC${new Date().getFullYear()}${String(count + 1).padStart(5, '0')}`,
        itemId: item.id,
        consignmentId: consignment.id,
        appraiserId: appraisal.appraiserId,
        createdById: user.sub,
        creatorRole: user.role,
        reason: dto.reason.trim(),
        estimatedRefurbishCost: appraisal.estimatedRefurbishCost,
        incurredRefurbishCost: item.refurbishCost,
        additionalLaborCost: labor.toFixed(2),
        additionalMaterialCost: material.toFixed(2),
        currentListedPrice: item.listedPrice,
        revisedListedPrice: revised.toFixed(2),
        affectListing: !!dto.affectListing,
        listingDelayDays: dto.affectListing ? delayDays : 0,
        beforePhotos: dto.beforePhotos || [],
        deviationReason: dto.deviationReason?.trim() || '',
        status: 'PENDING',
      });
      await m.save(overrun);

      // 同步生成一条协同工单，便于六方围绕同一件家具留言追踪（工单留痕不做裁定）
      const ticket = m.create(Ticket, {
        consignmentId: consignment.id,
        itemId: item.id,
        type: 'REFURBISH_OVERRUN',
        createdBy: user.sub,
        creatorRole: user.role,
        status: 'OPEN',
        resolution: 'PENDING',
        liableParty: 'SHARED',
        title: `翻新成本超预算待卖家确认（${overrun.code}）`,
        description:
          `${dto.reason.trim()}\n` +
          `新增工时费 ¥${labor.toFixed(2)}、材料费 ¥${material.toFixed(2)}；` +
          `预计售价 ¥${item.listedPrice} → ¥${revised.toFixed(2)}；` +
          `${dto.affectListing ? `上架时间延后约 ${delayDays} 天；` : '不影响上架时间；'}` +
          `估价偏差原因已留档用于估价师考核。`,
      });
      await m.save(ticket);

      return sanitizeOverrun(overrun, user.role);
    });
  }

  /** 列表：卖家仅看自己寄卖的确认单；内部角色看全部 */
  @Get('overruns')
  async list(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: string,
    @Query('itemId') itemId?: string,
  ) {
    const where: any = {};
    if (status) {
      if (!['PENDING', 'ACCEPTED', 'REJECTED_REDUCE', 'REJECTED_CANCEL'].includes(status)) {
        throw new BadRequestException('未知状态');
      }
      where.status = status as OverrunStatus;
    }
    if (itemId) where.itemId = itemId;

    let rows: RefurbishOverrunConfirmation[];
    if (user.role === 'SELLER') {
      const consignments = await this.ds.getRepository(Consignment).find({
        where: { sellerId: user.sub },
      });
      const ids = consignments.map((c) => c.id);
      rows = ids.length
        ? await this.ds.getRepository(RefurbishOverrunConfirmation).find({
            where: { ...where, consignmentId: In(ids) },
            order: { createdAt: 'DESC' },
          })
        : [];
    } else {
      rows = await this.ds.getRepository(RefurbishOverrunConfirmation).find({
        where,
        order: { createdAt: 'DESC' },
      });
    }

    const itemIds = Array.from(new Set(rows.map((r) => r.itemId)));
    const items = itemIds.length
      ? await this.ds.getRepository(Item).find({ where: { id: In(itemIds) } })
      : [];
    const itemMap = new Map(items.map((i) => [i.id, i]));
    const appraiserIds = Array.from(new Set(rows.map((r) => r.appraiserId)));
    const appraisers = appraiserIds.length
      ? await this.ds.getRepository(User).find({ where: { id: In(appraiserIds) } })
      : [];
    const appraiserMap = new Map(appraisers.map((u) => [u.id, u]));

    return rows.map((r) => ({
      ...sanitizeOverrun(r, user.role),
      itemTitle: itemMap.get(r.itemId)?.title || '-',
      itemStatus: itemMap.get(r.itemId)?.status || '-',
      appraiserName: appraiserMap.get(r.appraiserId)?.name || '-',
    }));
  }

  @Get('overruns/:id')
  async detail(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    const row = await this.ds
      .getRepository(RefurbishOverrunConfirmation)
      .findOne({ where: { id } });
    if (!row) throw new NotFoundException('超预算确认单不存在');
    if (user.role === 'SELLER') {
      const c = await this.ds.getRepository(Consignment).findOne({
        where: { id: row.consignmentId },
      });
      if (c?.sellerId !== user.sub) {
        throw new ForbiddenException('只能查看自己寄卖的确认单');
      }
    }
    return sanitizeOverrun(row, user.role);
  }

  /** 卖家确认：接受（追加费用成交款扣除）/ 拒绝并降价上架 / 拒绝并取消寄卖 */
  @Roles('SELLER')
  @Post('overruns/:id/decision')
  async decide(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: DecisionDto,
  ) {
    if (!['ACCEPT', 'REJECT_REDUCE', 'REJECT_CANCEL'].includes(dto.decision)) {
      throw new BadRequestException('请选择确认结果');
    }
    return this.ds.transaction(async (m) => {
      const overrun = await m.findOne(RefurbishOverrunConfirmation, {
        where: { id },
      });
      if (!overrun) throw new NotFoundException('超预算确认单不存在');
      if (overrun.status !== 'PENDING') {
        throw new BadRequestException('该确认单已有处理结果');
      }
      const consignment = await m.findOne(Consignment, {
        where: { id: overrun.consignmentId },
      });
      if (!consignment || consignment.sellerId !== user.sub) {
        throw new ForbiddenException('只能确认自己寄卖商品的超预算确认单');
      }
      const item = await m.findOne(Item, { where: { id: overrun.itemId } });
      if (!item) throw new NotFoundException('商品不存在');

      const extra =
        Number(overrun.additionalLaborCost) +
        Number(overrun.additionalMaterialCost);

      if (dto.decision === 'ACCEPT') {
        // 接受：追加工时+材料计入翻新费，成交结算时从成交款扣除
        item.refurbishCost = (Number(item.refurbishCost) + extra).toFixed(2);
        const revised = Number(overrun.revisedListedPrice);
        item.listedPrice = revised.toFixed(2);
        if (Number(item.minDealPrice) > revised) {
          item.minDealPrice = revised.toFixed(2);
        }
        item.refurbishedAt = new Date();
        await m.save(item);
        await m.save(
          m.create(ItemWorkLog, {
            itemId: item.id,
            assigneeId: user.sub,
            type: 'REPAINT',
            note:
              `超预算追加翻新（确认单 ${overrun.code}，卖家已接受）：` +
              `工时费 ¥${overrun.additionalLaborCost} + 材料费 ¥${overrun.additionalMaterialCost}`,
            cost: extra.toFixed(2),
          }),
        );
        overrun.status = 'ACCEPTED';
      } else if (dto.decision === 'REJECT_REDUCE') {
        const reduced = Number(dto.reducedPrice || 0);
        if (!(reduced > 0)) {
          throw new BadRequestException('请填写降价后的挂牌价');
        }
        if (reduced >= Number(overrun.currentListedPrice)) {
          throw new BadRequestException(
            `降价上架价格需低于当前挂牌价 ¥${overrun.currentListedPrice}`,
          );
        }
        // 拒绝追加翻新：按现状直接降价上架，追加费用不发生、不从成交款扣除
        item.listedPrice = reduced.toFixed(2);
        if (Number(item.minDealPrice) > reduced) {
          item.minDealPrice = reduced.toFixed(2);
        }
        await m.save(item);
        overrun.status = 'REJECTED_REDUCE';
      } else {
        // 拒绝并取消寄卖：商品下架；因估价偏差导致，不计卖家反悔
        overrun.status = 'REJECTED_CANCEL';
        item.status = 'OFF_SHELF';
        await m.save(item);
        consignment.status = 'CANCELLED';
        consignment.cancelReason = 'OVERRUN_REJECTED';
        consignment.sellerNote =
          `${consignment.sellerNote}\n[超预算取消] 卖家不接受追加翻新费用，取消寄卖。`.trim();
        await m.save(consignment);
      }

      overrun.sellerDecisionNote = dto.note?.trim() || '';
      overrun.sellerDecidedAt = new Date();
      await m.save(overrun);
      return { overrun, item, consignment };
    });
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RefurbishOverrunConfirmation,
      Item,
      ItemWorkLog,
      Consignment,
      Appraisal,
      User,
      Ticket,
    ]),
  ],
  controllers: [RefurbishController],
})
export class RefurbishModule {}
