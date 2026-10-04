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
} from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  Item,
  ItemWorkLog,
  WorkLogType,
} from '../entities/item.entity';
import { Consignment } from '../entities/consignment.entity';
import { Appraisal } from '../entities/appraisal.entity';
import { RefurbishOverrun } from '../entities/refurbish-overrun.entity';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt.guard';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
class AddWorkLogDto {
  type: WorkLogType;
  note?: string;
  cost?: number;
}

class AdvanceDto {
  to: 'PHOTOGRAPHY' | 'LISTED' | 'PREPARING';
  description?: string;
  photos?: string[];
  warehouseSlot?: string;
  deliveryRadiusKm?: number;
  listedPrice?: number;
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  PREPARING: ['PHOTOGRAPHY', 'OFF_SHELF'],
  // OVERRUN_PENDING 只能由超预算确认单的卖家决定来流转，仓库不能直接推进
  OVERRUN_PENDING: [],
  PHOTOGRAPHY: ['LISTED', 'PREPARING'],
  LISTED: ['RESERVED', 'OFF_SHELF'],
  RESERVED: ['LISTED', 'SOLD'],
  SOLD: ['DELIVERED', 'RETURNED'],
  DELIVERED: ['RETURNED', 'SETTLED'],
  RETURNED: ['LISTED', 'OFF_SHELF'],
};

/** 买家不可见的内部字段：翻新前旧照片仅保留在内部审计记录中 */
function sanitizeForBuyer(item: any) {
  const { archivedInternalPhotos, approvedOverrunCost, ...rest } = item;
  return rest;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('items')
export class ItemController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** 买家市场只看在售；仓库/翻新/运营可按状态看全部 */
  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('location') location?: string,
  ) {
    const repo = this.ds.getRepository(Item);
    const qb = repo.createQueryBuilder('i');
    if (user.role === 'BUYER') {
      qb.where('i.status = :s', { s: 'LISTED' });
    } else if (status) {
      qb.where('i.status = :s', { s: status });
    } else {
      qb.where('i.status != :s', { s: 'OFF_SHELF' });
    }
    if (category) qb.andWhere('i.category = :c', { c: category });
    if (location) qb.andWhere('i.location = :l', { l: location });
    qb.orderBy('i."createdAt"', 'DESC');
    const items = await qb.getMany();
    const consignmentIds = Array.from(new Set(items.map((i) => i.consignmentId)));
    const consignments = consignmentIds.length
      ? await this.ds.getRepository(Consignment).find({
          where: { id: In(consignmentIds) },
        })
      : [];
    const cMap = new Map(consignments.map((c) => [c.id, c]));
    return items.map((i) => {
      const c = cMap.get(i.consignmentId);
      const row: any = {
        ...i,
        sellerId: c?.sellerId,
        brand: c?.brand,
        elevator: c?.elevator,
        floor: c?.floor,
        disassemblable: c?.disassemblable,
      };
      // 买家只看翻新后对外状态：旧照片归档字段不下发
      if (user.role === 'BUYER') return sanitizeForBuyer(row);
      return row;
    });
  }

  @Get(':id')
  async detail(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    const item = await this.ds.getRepository(Item).findOne({ where: { id } });
    if (!item) throw new NotFoundException('商品不存在');
    const consignment = await this.ds
      .getRepository(Consignment)
      .findOne({ where: { id: item.consignmentId } });
    const appraisal = await this.ds
      .getRepository(Appraisal)
      .findOne({ where: { consignmentId: item.consignmentId } });
    const workLogs = await this.ds.getRepository(ItemWorkLog).find({
      where: { itemId: id },
      order: { createdAt: 'DESC' },
    });
    const overrun = await this.ds.getRepository(RefurbishOverrun).findOne({
      where: { itemId: id },
      order: { createdAt: 'DESC' },
    });

    if (user.role === 'BUYER') {
      // 买家只看翻新后的真实状态：内部审计旧照片与已确认超预算额度不下发
      return {
        item: sanitizeForBuyer(item),
        defectNote: item.defectNote,
        workLogs: [],
        appraisal: null,
        overrun: null,
      };
    }
    return { item, consignment, appraisal, workLogs, overrun };
  }

  /** 清洁、补漆、维修、拍照、上架描述、入库登记——作业即记账 */
  @Roles('WAREHOUSE', 'REFURBISHER', 'OPS')
  @Post(':id/work-logs')
  async addWorkLog(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: AddWorkLogDto,
  ) {
    const validTypes: WorkLogType[] = [
      'CLEANING',
      'REPAINT',
      'REPAIR',
      'PHOTOGRAPHY',
      'LISTING_COPY',
      'STORAGE',
    ];
    if (!validTypes.includes(dto.type)) {
      throw new BadRequestException('未知作业类型');
    }
    return this.ds.transaction(async (m) => {
      const item = await m.findOne(Item, { where: { id } });
      if (!item) throw new NotFoundException('商品不存在');
      if (item.status === 'SOLD' || item.status === 'DELIVERED') {
        throw new BadRequestException('已成交商品不可再登记作业');
      }
      if (item.status === 'OVERRUN_PENDING') {
        throw new BadRequestException(
          '翻新成本超预算，正等待卖家确认，确认前暂停翻新作业',
        );
      }
      const cost = Number(dto.cost || 0);

      // 补漆/维修费用受"估价预算 + 卖家已确认超预算额度"管控
      if ((dto.type === 'REPAINT' || dto.type === 'REPAIR') && cost > 0) {
        const consignment = await m.findOne(Consignment, {
          where: { id: item.consignmentId },
        });
        const appraisal = consignment
          ? await m.findOne(Appraisal, {
              where: { consignmentId: consignment.id },
            })
          : null;
        const budget = Number(appraisal?.estimatedRefurbishCost || 0);
        const budgetLeft = Math.max(0, budget - Number(item.refurbishCost));
        const needApproved = Math.max(0, cost - budgetLeft);

        if (needApproved > 0) {
          const accepted = await m.find(RefurbishOverrun, {
            where: { itemId: id, status: 'ACCEPTED' },
          });
          let quotaLeft = 0;
          accepted.forEach(
            (o) =>
              (quotaLeft += Number(o.extraTotal) - Number(o.extraSpentCost)),
          );
          if (quotaLeft < needApproved) {
            throw new BadRequestException(
              `本次翻新费 ¥${cost.toFixed(2)} 超出估价预算剩余 ¥${budgetLeft.toFixed(2)}，` +
                `卖家已确认追加额度剩余 ¥${quotaLeft.toFixed(2)}；` +
                '请先发起翻新超预算确认并经卖家接受，或调整费用',
            );
          }
          // 实际追加支出按顺序占用各确认单额度
          let toAllocate = needApproved;
          for (const o of accepted) {
            if (toAllocate <= 0) break;
            const left = Number(o.extraTotal) - Number(o.extraSpentCost);
            const use = Math.min(left, toAllocate);
            o.extraSpentCost = (Number(o.extraSpentCost) + use).toFixed(2);
            await m.save(o);
            toAllocate -= use;
          }
        }
      }

      const log = m.create(ItemWorkLog, {
        itemId: id,
        assigneeId: user.sub,
        type: dto.type,
        note: dto.note || '',
        cost: cost.toFixed(2),
      });
      await m.save(log);

      if (dto.type === 'CLEANING') {
        item.cleaningCost = (Number(item.cleaningCost) + cost).toFixed(2);
      } else if (dto.type === 'REPAINT' || dto.type === 'REPAIR') {
        item.refurbishCost = (Number(item.refurbishCost) + cost).toFixed(2);
      } else if (dto.type === 'STORAGE') {
        if (dto.note) item.warehouseSlot = dto.note;
        if (!item.enteredWarehouseAt) item.enteredWarehouseAt = new Date();
        item.location = 'WAREHOUSE';
      }
      await m.save(item);
      return { log, item };
    });
  }

  /** 状态推进：清洁完成→拍照→上架（写描述/照片/库位/配送范围） */
  @Roles('WAREHOUSE', 'REFURBISHER', 'OPS')
  @Post(':id/advance')
  async advance(@Param('id') id: string, @Body() dto: AdvanceDto) {
    return this.ds.transaction(async (mgr) => {
      const item = await mgr.findOne(Item, { where: { id } });
      if (!item) throw new NotFoundException('商品不存在');
      const allowed = VALID_TRANSITIONS[item.status] || [];
      if (!dto.to || !allowed.includes(dto.to)) {
        throw new BadRequestException(
          `商品当前 ${item.status}，不能转到 ${dto.to}；允许：${allowed.join(', ') || '无'}`,
        );
      }

      // 发生过翻新超预算的商品，上架前必须翻新完成重新拍摄并更新瑕疵说明
      if (dto.to === 'LISTED') {
        const overrun = await mgr.findOne(RefurbishOverrun, {
          where: { itemId: id },
          order: { createdAt: 'DESC' },
        });
        if (
          overrun &&
          ['ACCEPTED', 'REJECTED_REDUCE'].includes(overrun.status) &&
          !overrun.photoCompletedAt
        ) {
          throw new BadRequestException(
            '该商品翻新方案经卖家重新确认，需先重新拍摄翻新后照片、更新瑕疵说明，才能上架',
          );
        }
      }

      item.status = dto.to as any;
      if (dto.description != null) item.description = dto.description;
      // 超预算重拍商品的照片只由 /refurbish-overruns/:id/rephotos 更新，旧照片已归档内部审计
      const hasOverrunPhotos = await mgr.findOne(RefurbishOverrun, {
        where: { itemId: id },
      });
      if (dto.photos && !hasOverrunPhotos) item.photos = dto.photos;
      if (dto.warehouseSlot) item.warehouseSlot = dto.warehouseSlot;
      if (dto.deliveryRadiusKm != null) {
        item.deliveryRadiusKm = Number(dto.deliveryRadiusKm);
      }
      if (dto.listedPrice != null && Number(dto.listedPrice) > 0) {
        item.listedPrice = Number(dto.listedPrice).toFixed(2);
      }
      if (dto.to === 'LISTED') {
        if (!item.description && item.photos.length === 0) {
          throw new BadRequestException('上架前需填写描述或上传拍照');
        }
        item.listedAt = new Date();
        const consignment = await mgr.findOne(Consignment, {
          where: { id: item.consignmentId },
        });
        if (consignment && consignment.status !== 'LISTED') {
          consignment.status = 'LISTED';
          await mgr.save(consignment);
        }
      }
      await mgr.save(item);
      return item;
    });
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Item, ItemWorkLog, Consignment, Appraisal])],
  controllers: [ItemController],
})
export class ItemModule {}
