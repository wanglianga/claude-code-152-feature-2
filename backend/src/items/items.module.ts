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
  Item,
  ItemWorkLog,
  WorkLogType,
} from '../entities/item.entity';
import { Consignment } from '../entities/consignment.entity';
import { Appraisal } from '../entities/appraisal.entity';
import { RefurbishOverrunConfirmation } from '../entities/refurbish-confirmation.entity';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt.guard';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';

/** 平台内部角色：可见旧照片归档等内部审计记录 */
const INTERNAL_ROLES = [
  'WAREHOUSE',
  'REFURBISHER',
  'CS',
  'OPS',
  'ADMIN',
  'APPRAISER',
  'DELIVERY',
];

/** 买家/卖家视角脱敏：翻新前旧照片与旧瑕疵说明仅保留在内部审计记录中 */
function publicItem<T extends Partial<Item>>(item: T, role: string): T {
  if (INTERNAL_ROLES.includes(role)) return item;
  const { archivedPhotos, archivedDefectNote, ...rest } = item as any;
  return rest;
}

class AddWorkLogDto {
  type: WorkLogType;
  note?: string;
  cost?: number;
}

class AdvanceDto {
  to: 'PHOTOGRAPHY' | 'LISTED' | 'PREPARING';
  description?: string;
  photos?: string[];
  defectNote?: string;
  warehouseSlot?: string;
  deliveryRadiusKm?: number;
  listedPrice?: number;
}

class RephotographDto {
  /** 翻新后重新拍摄的照片（买家看到的真实状态） */
  photos: string[];
  /** 更新后的瑕疵说明（翻新后的真实状态） */
  defectNote: string;
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  PREPARING: ['PHOTOGRAPHY', 'OFF_SHELF'],
  PHOTOGRAPHY: ['LISTED', 'PREPARING'],
  LISTED: ['RESERVED', 'OFF_SHELF'],
  RESERVED: ['LISTED', 'SOLD'],
  SOLD: ['DELIVERED', 'RETURNED'],
  DELIVERED: ['RETURNED', 'SETTLED'],
  RETURNED: ['LISTED', 'OFF_SHELF'],
};

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
      return publicItem(
        {
          ...i,
          sellerId: c?.sellerId,
          brand: c?.brand,
          elevator: c?.elevator,
          floor: c?.floor,
          disassemblable: c?.disassemblable,
        },
        user.role,
      );
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
    if (user.role === 'SELLER' && consignment?.sellerId !== user.sub) {
      throw new ForbiddenException('只能查看自己寄卖的商品');
    }
    const appraisal = await this.ds
      .getRepository(Appraisal)
      .findOne({ where: { consignmentId: item.consignmentId } });
    const workLogs = await this.ds.getRepository(ItemWorkLog).find({
      where: { itemId: id },
      order: { createdAt: 'DESC' },
    });
    const overruns = await this.ds
      .getRepository(RefurbishOverrunConfirmation)
      .find({ where: { itemId: id }, order: { createdAt: 'DESC' } });
    const internal = INTERNAL_ROLES.includes(user.role);
    return {
      item: publicItem(item, user.role),
      consignment,
      appraisal,
      workLogs,
      // 超预算确认单的估价偏差原因仅内部角色可见
      overrunConfirmations: overruns.map((o) =>
        internal ? o : { ...o, deviationReason: '' },
      ),
    };
  }

  /**
   * 翻新完成后重新拍摄并更新瑕疵说明：
   * 买家看到的是翻新后的真实状态；原照片/旧瑕疵说明只保留在内部审计记录中。
   */
  @Roles('WAREHOUSE', 'REFURBISHER', 'OPS', 'ADMIN')
  @Post(':id/rephotograph')
  async rephotograph(@Param('id') id: string, @Body() dto: RephotographDto) {
    const photos = (dto.photos || []).filter(Boolean);
    if (photos.length === 0) {
      throw new BadRequestException('请上传翻新后的重新拍摄照片');
    }
    if (dto.defectNote == null || !String(dto.defectNote).trim()) {
      throw new BadRequestException('请更新翻新后的瑕疵说明（如实描述剩余瑕疵）');
    }
    return this.ds.transaction(async (m) => {
      const item = await m.findOne(Item, { where: { id } });
      if (!item) throw new NotFoundException('商品不存在');
      if (!['PREPARING', 'PHOTOGRAPHY'].includes(item.status)) {
        throw new BadRequestException(
          `商品当前 ${item.status}，翻新重拍仅在清洁翻新/拍照阶段可操作`,
        );
      }
      // 原照片与旧瑕疵说明归档（仅内部审计），新照片/说明对买家展示
      if (item.photos.length) {
        item.archivedPhotos = Array.from(
          new Set([...item.archivedPhotos, ...item.photos]),
        );
      }
      if (item.defectNote) item.archivedDefectNote = item.defectNote;
      item.photos = photos;
      item.defectNote = String(dto.defectNote).trim();
      item.refurbishedAt = new Date();
      if (item.status === 'PREPARING') item.status = 'PHOTOGRAPHY';
      await m.save(item);
      await m.save(
        m.create(ItemWorkLog, {
          itemId: item.id,
          type: 'PHOTOGRAPHY',
          note: '翻新完成后重新拍摄，已更新瑕疵说明；旧照片转入内部审计归档',
          cost: '0',
        }),
      );
      return item;
    });
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
      const cost = Number(dto.cost || 0);
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
      // 存在待卖家确认的超预算单时，必须先有结论才能继续
      const pendingOverrun = await mgr.count(RefurbishOverrunConfirmation, {
        where: { itemId: id, status: 'PENDING' },
      });
      if (pendingOverrun > 0 && dto.to !== 'PREPARING') {
        throw new BadRequestException(
          '存在待卖家确认的翻新超预算确认单，需卖家接受或拒绝后才能继续上架',
        );
      }
      item.status = dto.to as any;
      if (dto.description != null) item.description = dto.description;
      if (dto.defectNote != null) item.defectNote = dto.defectNote;
      if (dto.photos) {
        // 上架照片被替换时，旧照片只保留在内部审计归档中
        const changed =
          dto.photos.length !== item.photos.length ||
          dto.photos.some((p, idx) => p !== item.photos[idx]);
        if (changed && item.photos.length) {
          item.archivedPhotos = Array.from(
            new Set([...item.archivedPhotos, ...item.photos]),
          );
        }
        item.photos = dto.photos;
      }
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
  imports: [
    TypeOrmModule.forFeature([
      Item,
      ItemWorkLog,
      Consignment,
      Appraisal,
      RefurbishOverrunConfirmation,
    ]),
  ],
  controllers: [ItemController],
})
export class ItemModule {}
