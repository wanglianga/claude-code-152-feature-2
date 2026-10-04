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
  RefurbishOverrun,
  RefurbishOverrunStatus,
  AppraisalDeviationCategory,
} from '../entities/refurbish-overrun.entity';
import { Item, ItemWorkLog } from '../entities/item.entity';
import { Consignment } from '../entities/consignment.entity';
import { Appraisal } from '../entities/appraisal.entity';
import { User } from '../entities/user.entity';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt.guard';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';

const INTERNAL_ROLES = [
  'APPRAISER',
  'WAREHOUSE',
  'REFURBISHER',
  'DELIVERY',
  'CS',
  'OPS',
  'ADMIN',
];

class CreateOverrunDto {
  reason: string;
  discoveryPhotos?: string[];
  extraLaborCost: number;
  extraMaterialCost: number;
  suggestedPrice?: number;
  priceImpactNote?: string;
  delayDays?: number;
  listingImpact?: 'DELAY' | 'NO_DELAY';
  deviationCategory?: AppraisalDeviationCategory;
  deviationNote?: string;
}

class DecideDto {
  decision: 'ACCEPT' | 'REDUCE_LIST' | 'CANCEL_CONSIGNMENT';
  sellerNote?: string;
  /** 拒绝追加翻新、选择降价上架时的降价后价格 */
  reducedPrice?: number;
}

class RephotosDto {
  photos: string[];
  /** 翻新后的瑕疵说明（买家可见的真实状态） */
  defectNote: string;
}

class DeviationReviewDto {
  deviationCategory: AppraisalDeviationCategory;
  deviationNote?: string;
}

const money = (n: number) => n.toFixed(2);

/**
 * 翻新成本超预算确认：
 * 清洁时发现估价时未预见的损伤（如餐桌划痕比估价时严重，需整体重新打磨上漆），
 * 仓库把新增工时费、材料费、预计售价变化、是否影响上架时间推给卖家确认。
 *  - 接受：追加费用计入翻新成本，从成交款扣除；翻新完成后重新拍摄、更新瑕疵说明
 *  - 拒绝追加：按现状降价上架，或取消寄卖
 * 平台保留估价偏差原因（卖家申报失真 / 估价师低估 / 不可预见）用于考核估价师。
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('refurbish-overruns')
export class RefurbishOverrunController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** 仓库/翻新师在清洁翻新中发起超预算确认（仅清洁翻新中的商品） */
  @Roles('WAREHOUSE', 'REFURBISHER', 'OPS')
  @Post('item/:itemId')
  async create(
    @CurrentUser() user: JwtPayload,
    @Param('itemId') itemId: string,
    @Body() dto: CreateOverrunDto,
  ) {
    if (!dto.reason?.trim()) {
      throw new BadRequestException('请说明超预算原因（发现的新问题）');
    }
    const labor = Number(dto.extraLaborCost || 0);
    const material = Number(dto.extraMaterialCost || 0);
    if (!(labor >= 0) || !(material >= 0) || labor + material <= 0) {
      throw new BadRequestException('新增工时费与材料费之和必须大于 0');
    }
    const deviation =
      dto.deviationCategory ||
      ('UNFORESEEABLE' as AppraisalDeviationCategory);
    if (
      ![
        'SELLER_MISDESCRIBE',
        'APPRAISER_UNDERESTIMATE',
        'UNFORESEEABLE',
      ].includes(deviation)
    ) {
      throw new BadRequestException('未知估价偏差归因');
    }

    return this.ds.transaction(async (m) => {
      const item = await m.findOne(Item, { where: { id: itemId } });
      if (!item) throw new NotFoundException('商品不存在');
      if (item.status !== 'PREPARING') {
        throw new BadRequestException(
          `商品当前 ${item.status}，仅清洁翻新中的商品可发起超预算确认`,
        );
      }
      const consignment = await m.findOne(Consignment, {
        where: { id: item.consignmentId },
      });
      if (!consignment) throw new NotFoundException('寄卖单不存在');
      const appraisal = await m.findOne(Appraisal, {
        where: { consignmentId: consignment.id },
      });
      if (!appraisal) throw new NotFoundException('估价单缺失，无法比对预算');

      const pending = await m.findOne(RefurbishOverrun, {
        where: { itemId, status: 'PENDING_SELLER' },
      });
      if (pending) {
        throw new BadRequestException('该商品已有待卖家确认的超预算单据');
      }

      const extraTotal = labor + material;
      const delayDays = Math.max(0, Number(dto.delayDays || 0));
      const count = await m.count(RefurbishOverrun);
      const overrun = m.create(RefurbishOverrun, {
        code: `RO${new Date().getFullYear()}${String(count + 1).padStart(5, '0')}`,
        consignmentId: consignment.id,
        itemId: item.id,
        appraisalId: appraisal.id,
        appraiserId: appraisal.appraiserId,
        createdById: user.sub,
        creatorRole: user.role,
        reason: dto.reason.trim(),
        discoveryPhotos: dto.discoveryPhotos || [],
        extraLaborCost: money(labor),
        extraMaterialCost: money(material),
        extraTotal: money(extraTotal),
        extraSpentCost: '0.00',
        budgetedRefurbishCost: String(appraisal.estimatedRefurbishCost || 0),
        incurredRefurbishCost: money(
          Number(item.cleaningCost) + Number(item.refurbishCost),
        ),
        currentListedPrice: String(item.listedPrice),
        suggestedPrice: money(Number(dto.suggestedPrice || item.listedPrice)),
        priceImpactNote: dto.priceImpactNote || '',
        delayDays,
        listingImpact:
          dto.listingImpact === 'NO_DELAY'
            ? 'NO_DELAY'
            : dto.listingImpact === 'DELAY' || delayDays > 0
              ? 'DELAY'
              : 'NO_DELAY',
        status: 'PENDING_SELLER',
        deviationCategory: deviation,
        deviationNote: dto.deviationNote || '',
      });
      await m.save(overrun);

      item.status = 'OVERRUN_PENDING';
      await m.save(item);
      return this.buildDetail(m, overrun.id, user);
    });
  }

  /** 列表：卖家只看自己的；内部角色可按状态/估价师筛选（估价偏差考核） */
  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: string,
    @Query('appraiserId') appraiserId?: string,
  ) {
    const repo = this.ds.getRepository(RefurbishOverrun);
    let rows: RefurbishOverrun[];
    if (user.role === 'SELLER') {
      const consignments = await this.ds.getRepository(Consignment).find({
        where: { sellerId: user.sub },
      });
      const ids = consignments.map((c) => c.id);
      rows = ids.length
        ? await repo.find({
            where: {
              consignmentId: In(ids),
              ...(status ? { status: status as RefurbishOverrunStatus } : {}),
            },
            order: { createdAt: 'DESC' },
          })
        : [];
    } else if (!INTERNAL_ROLES.includes(user.role)) {
      throw new ForbiddenException('无权查看翻新超预算确认单');
    } else {
      rows = await repo.find({
        where: {
          ...(status ? { status: status as RefurbishOverrunStatus } : {}),
          ...(appraiserId ? { appraiserId } : {}),
        },
        order: { createdAt: 'DESC' },
      });
    }
    return this.enrich(rows);
  }

  @Get(':id')
  async detail(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.buildDetail(this.ds.manager, id, user, true);
  }

  /** 卖家确认：接受追加（费用从成交款扣除）/ 降价上架 / 取消寄卖 */
  @Roles('SELLER')
  @Post(':id/decide')
  async decide(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: DecideDto,
  ) {
    if (!['ACCEPT', 'REDUCE_LIST', 'CANCEL_CONSIGNMENT'].includes(dto.decision)) {
      throw new BadRequestException('请选择：接受 / 降价上架 / 取消寄卖');
    }
    return this.ds.transaction(async (m) => {
      const overrun = await m.findOne(RefurbishOverrun, { where: { id } });
      if (!overrun) throw new NotFoundException('超预算确认单不存在');
      const consignment = await m.findOne(Consignment, {
        where: { id: overrun.consignmentId },
      });
      if (!consignment || consignment.sellerId !== user.sub) {
        throw new ForbiddenException('只能确认自己寄卖商品的超预算单据');
      }
      if (overrun.status !== 'PENDING_SELLER') {
        throw new BadRequestException(`该确认单当前为 ${overrun.status}，已不可更改`);
      }
      const item = await m.findOne(Item, { where: { id: overrun.itemId } });
      if (!item) throw new NotFoundException('商品不存在');

      overrun.sellerNote = dto.sellerNote || '';
      overrun.sellerDecidedAt = new Date();

      if (dto.decision === 'ACCEPT') {
        // 卖家接受：登记已确认追加额度，翻新继续；实际追加作业以作业记录为准、受确认额度封顶
        overrun.status = 'ACCEPTED';
        item.approvedOverrunCost = money(
          Number(item.approvedOverrunCost) + Number(overrun.extraTotal),
        );
        item.status = 'PREPARING';
        await m.save(
          m.create(ItemWorkLog, {
            itemId: item.id,
            assigneeId: user.sub,
            type: 'REPAINT',
            note: `卖家确认超预算追加翻新预算 ¥${overrun.extraTotal}（确认单 ${overrun.code}，工时 ¥${overrun.extraLaborCost} + 材料 ¥${overrun.extraMaterialCost}）`,
            cost: '0.00',
          }),
        );
      } else if (dto.decision === 'REDUCE_LIST') {
        const reduced = Number(dto.reducedPrice || 0);
        if (!(reduced > 0)) {
          throw new BadRequestException('请填写降价后的挂牌价');
        }
        if (reduced >= Number(item.listedPrice)) {
          throw new BadRequestException(
            `降价后价格必须低于当前挂牌价 ¥${item.listedPrice}`,
          );
        }
        // 拒绝追加翻新：按现状降价上架，直接进入重新拍摄环节
        overrun.status = 'REJECTED_REDUCE';
        overrun.reducedPrice = money(reduced);
        item.listedPrice = money(reduced);
        if (Number(item.minDealPrice) > reduced) {
          item.minDealPrice = money(reduced);
        }
        item.status = 'PHOTOGRAPHY';
      } else {
        // 取消寄卖：商品下架、寄卖终止（区别于卖家主动反悔，不计入卖家反悔画像）
        overrun.status = 'REJECTED_CANCEL';
        item.status = 'OFF_SHELF';
        consignment.status = 'OVERRUN_CANCELLED' as any;
      }

      await m.save(overrun);
      await m.save(item);
      await m.save(consignment);
      return this.buildDetail(m, overrun.id, user);
    });
  }

  /**
   * 翻新完成后仓库重新拍摄并更新瑕疵说明：
   * 旧照片（卖家瑕疵照 + 超预算发现照 + 翻新前商品照）归档到内部审计，买家只看到翻新后的照片与说明。
   */
  @Roles('WAREHOUSE', 'OPS', 'REFURBISHER')
  @Post(':id/rephotos')
  async rephotos(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: RephotosDto,
  ) {
    if (!dto.photos?.length) {
      throw new BadRequestException('请上传翻新后重新拍摄的照片');
    }
    if (!dto.defectNote?.trim()) {
      throw new BadRequestException('请填写翻新后的瑕疵说明（买家将看到真实状态）');
    }
    return this.ds.transaction(async (m) => {
      const overrun = await m.findOne(RefurbishOverrun, { where: { id } });
      if (!overrun) throw new NotFoundException('超预算确认单不存在');
      if (!['ACCEPTED', 'REJECTED_REDUCE'].includes(overrun.status)) {
        throw new BadRequestException(
          '卖家接受追加翻新、或选择降价上架后，才能重新拍摄上架',
        );
      }
      const item = await m.findOne(Item, { where: { id: overrun.itemId } });
      if (!item) throw new NotFoundException('商品不存在');
      if (item.status !== 'PHOTOGRAPHY') {
        throw new BadRequestException(
          `商品当前 ${item.status}，需在拍照环节重新拍摄`,
        );
      }
      const consignment = await m.findOne(Consignment, {
        where: { id: overrun.consignmentId },
      });

      // 旧照片只进内部审计记录
      const archived = Array.from(
        new Set([
          ...(item.archivedInternalPhotos || []),
          ...(consignment?.defectPhotos || []),
          ...(overrun.discoveryPhotos || []),
          ...(item.photos || []),
        ]),
      );
      item.archivedInternalPhotos = archived;
      item.photos = dto.photos;
      item.defectNote = dto.defectNote.trim();
      await m.save(item);

      overrun.photoCompletedAt = new Date();
      await m.save(overrun);

      await m.save(
        m.create(ItemWorkLog, {
          itemId: item.id,
          assigneeId: user.sub,
          type: 'PHOTOGRAPHY',
          note: `翻新后重新拍摄 ${dto.photos.length} 张并更新瑕疵说明；翻新前旧照片已归档内部审计（确认单 ${overrun.code}）`,
          cost: '0.00',
        }),
      );
      return this.buildDetail(m, overrun.id, user);
    });
  }

  /** 运营复核估价偏差归因（考核估价师） */
  @Roles('OPS', 'ADMIN')
  @Post(':id/deviation')
  async reviewDeviation(
    @Param('id') id: string,
    @Body() dto: DeviationReviewDto,
  ) {
    if (
      ![
        'SELLER_MISDESCRIBE',
        'APPRAISER_UNDERESTIMATE',
        'UNFORESEEABLE',
      ].includes(dto.deviationCategory)
    ) {
      throw new BadRequestException('未知估价偏差归因');
    }
    return this.ds.transaction(async (m) => {
      const overrun = await m.findOne(RefurbishOverrun, { where: { id } });
      if (!overrun) throw new NotFoundException('超预算确认单不存在');
      overrun.deviationCategory = dto.deviationCategory;
      if (dto.deviationNote != null) overrun.deviationNote = dto.deviationNote;
      await m.save(overrun);
      return this.buildDetail(m, overrun.id, null);
    });
  }

  private async enrich(rows: RefurbishOverrun[]) {
    if (!rows.length) return [];
    const itemIds = Array.from(new Set(rows.map((r) => r.itemId)));
    const appraiserIds = Array.from(new Set(rows.map((r) => r.appraiserId)));
    const items = await this.ds.getRepository(Item).find({ where: { id: In(itemIds) } });
    const appraisers = await this.ds.getRepository(User).find({ where: { id: In(appraiserIds) } });
    const itemMap = new Map(items.map((i) => [i.id, i]));
    const appraiserMap = new Map(appraisers.map((u) => [u.id, u]));
    return rows.map((r) => ({
      ...r,
      itemTitle: itemMap.get(r.itemId)?.title,
      itemStatus: itemMap.get(r.itemId)?.status,
      appraiserName: appraiserMap.get(r.appraiserId)?.name || '-',
    }));
  }

  private async buildDetail(
    manager: DataSource['manager'] | DataSource,
    id: string,
    user: JwtPayload | null,
    checkAccess = false,
  ) {
    const m: any = manager;
    const overrun = await m.findOne(RefurbishOverrun, { where: { id } });
    if (!overrun) throw new NotFoundException('超预算确认单不存在');
    if (checkAccess && user) {
      if (user.role === 'SELLER') {
        const c = await m.findOne(Consignment, {
          where: { id: overrun.consignmentId },
        });
        if (c?.sellerId !== user.sub) {
          throw new ForbiddenException('无权查看该超预算确认单');
        }
      } else if (
        user.role === 'BUYER' ||
        !INTERNAL_ROLES.includes(user.role)
      ) {
        throw new ForbiddenException('无权查看该超预算确认单');
      }
    }
    const item = await m.findOne(Item, { where: { id: overrun.itemId } });
    const consignment = await m.findOne(Consignment, {
      where: { id: overrun.consignmentId },
    });
    const appraisal = await m.findOne(Appraisal, {
      where: { id: overrun.appraisalId },
    });
    const appraiser = await m.findOne(User, {
      where: { id: overrun.appraiserId },
    });
    const workLogs = await m.find(ItemWorkLog, {
      where: { itemId: overrun.itemId },
      order: { createdAt: 'DESC' },
    });
    return {
      overrun,
      item,
      consignment,
      appraisal,
      appraiserName: appraiser?.name || '-',
      workLogs,
    };
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RefurbishOverrun,
      Item,
      ItemWorkLog,
      Consignment,
      Appraisal,
      User,
    ]),
  ],
  controllers: [RefurbishOverrunController],
})
export class RefurbishOverrunModule {}
