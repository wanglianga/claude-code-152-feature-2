import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { Item } from '../entities/item.entity';
import { Order } from '../entities/order.entity';
import { Delivery } from '../entities/delivery.entity';
import { Ticket } from '../entities/ticket.entity';
import { RefurbishOverrun } from '../entities/refurbish-overrun.entity';
import { SellerProfile } from '../entities/seller-profile.entity';
import { User } from '../entities/user.entity';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard, Roles } from '../auth/roles.guard';

const CATEGORY_LABELS: Record<string, string> = {
  SOFA: '沙发',
  DINING_TABLE: '餐桌',
  KIDS_BED: '儿童床',
  BOOKCASE: '书柜',
  OFFICE_CHAIR: '办公椅',
  APPLIANCE_CABINET: '家电柜',
};

const CATEGORIES = Object.keys(CATEGORY_LABELS);

/**
 * 运营分析：按品类沉淀成交周期、翻新投入、退货原因与配送失败率，
 * 判断哪些商品适合入仓寄卖、哪些只适合同城自提；并输出卖家风险画像列表。
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  @Roles('OPS', 'ADMIN', 'CS')
  @Get('by-category')
  async byCategory() {
    const items = await this.ds.getRepository(Item).find();
    const orders = await this.ds.getRepository(Order).find();
    const deliveries = await this.ds.getRepository(Delivery).find();
    const tickets = await this.ds.getRepository(Ticket).find();

    const itemMap = new Map(items.map((i) => [i.id, i]));
    const orderById = new Map(orders.map((o) => [o.id, o]));

    const result = CATEGORIES.map((category) => {
      const catItems = items.filter((i) => i.category === category);
      const catItemIds = new Set(catItems.map((i) => i.id));
      const catOrders = orders.filter((o) => catItemIds.has(o.itemId));
      const catOrderIds = new Set(catOrders.map((o) => o.id));
      const catDeliveries = deliveries.filter((d) => catOrderIds.has(d.orderId));
      const catTickets = tickets.filter((t) => {
        const it = t.itemId ? itemMap.get(t.itemId) : null;
        return it?.category === category;
      });

      const listed = catItems.filter((i) => i.listedAt).length;
      const sold = catItems.filter((i) =>
        ['SOLD', 'DELIVERED', 'RETURNED'].includes(i.status),
      ).length;
      const returnedOrders = catOrders.filter((o) => o.status === 'RETURNED');

      // 成交周期：上架时间 -> 下单时间（天）
      const cycles: number[] = [];
      catOrders.forEach((o) => {
        const it = itemMap.get(o.itemId);
        if (it?.listedAt) {
          cycles.push(
            Math.max(
              0,
              (new Date(o.createdAt).getTime() -
                new Date(it.listedAt).getTime()) /
                86400000,
            ),
          );
        }
      });
      const avgCycle = cycles.length
        ? Math.round((cycles.reduce((a, b) => a + b, 0) / cycles.length) * 10) / 10
        : null;

      // 翻新投入：已成交商品的清洁+翻新均值，以及占均价比
      const refurbCosts = catItems.map(
        (i) => Number(i.cleaningCost) + Number(i.refurbishCost),
      );
      const totalRefurb = refurbCosts.reduce((a, b) => a + b, 0);
      const avgRefurb = sold
        ? Math.round((totalRefurb / Math.max(1, catItems.length)) * 100) / 100
        : 0;
      const dealPrices = catOrders
        .filter((o) => o.status !== 'RETURNED')
        .map((o) => Number(o.dealPrice));
      const avgDealPrice = dealPrices.length
        ? Math.round(dealPrices.reduce((a, b) => a + b, 0) / dealPrices.length)
        : 0;
      const refurbRatio = avgDealPrice
        ? Math.round((avgRefurb / avgDealPrice) * 1000) / 10
        : 0;

      // 退货原因：退货退款工单按工单类型聚类
      const returnReasons: Record<string, number> = {};
      catTickets
        .filter((t) => t.resolution === 'RETURN_REFUND')
        .forEach((t) => {
          returnReasons[t.type] = (returnReasons[t.type] || 0) + 1;
        });

      // 配送失败率
      const failed = catDeliveries.filter((d) => d.status === 'FAILED');
      const failRate = catDeliveries.length
        ? Math.round((failed.length / catDeliveries.length) * 1000) / 10
        : 0;
      const failReasons: Record<string, number> = {};
      failed.forEach((d) => {
        failReasons[d.failReason] = (failReasons[d.failReason] || 0) + 1;
      });

      const returnRate = catOrders.length
        ? Math.round((returnedOrders.length / catOrders.length) * 1000) / 10
        : 0;

      // 入仓 vs 自提建议：失败率>25% 或电梯/楼道受阻占比高 → 建议同城自提为主；
      // 翻新投入占比低、周期短、退货少 → 适合入仓寄卖
      const elevatorBlocks =
        (failReasons['ELEVATOR_TOO_SMALL'] || 0) +
        (failReasons['STAIR_TOO_NARROW'] || 0);
      let channelAdvice: string;
      if (failRate >= 25 || elevatorBlocks >= Math.max(1, failed.length / 2)) {
        channelAdvice = '建议同城自提为主（配送失败率高/大件进梯困难），可提供付费拆装搬运';
      } else if (avgCycle != null && avgCycle <= 7 && refurbRatio <= 12 && returnRate <= 15) {
        channelAdvice = '适合入仓寄卖（周转快、翻新投入低、退货少）';
      } else {
        channelAdvice = '可入仓但需控制翻新预算，按单评估配送范围';
      }

      return {
        category,
        categoryLabel: CATEGORY_LABELS[category],
        listedCount: listed,
        soldCount: sold,
        avgCycleDays: avgCycle,
        avgRefurbishCost: avgRefurb,
        avgDealPrice,
        refurbishCostRatioPct: refurbRatio,
        returnCount: returnedOrders.length,
        returnRatePct: returnRate,
        returnReasons,
        deliveryTotal: catDeliveries.length,
        deliveryFailed: failed.length,
        deliveryFailRatePct: failRate,
        deliveryFailReasons: failReasons,
        channelAdvice,
      }
    });

    return { categories: result, generatedAt: new Date() };
  }

  @Roles('OPS', 'ADMIN', 'CS', 'APPRAISER')
  @Get('seller-profiles')
  async sellerProfiles() {
    const profiles = await this.ds.getRepository(SellerProfile).find({
      order: { riskScore: 'DESC' },
    });
    const users = profiles.length
      ? await this.ds.getRepository(User).find({
          where: { id: In(profiles.map((p) => p.sellerId)) },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));
    return profiles.map((p) => ({
      ...p,
      sellerName: userMap.get(p.sellerId)?.name || '-',
      username: userMap.get(p.sellerId)?.username || '-',
    }));
  }

  @Roles('OPS', 'ADMIN', 'CS', 'APPRAISER')
  @Get('seller-profiles/:sellerId')
  async sellerProfile(@Param('sellerId') sellerId: string) {
    const profile = await this.ds
      .getRepository(SellerProfile)
      .findOne({ where: { sellerId } });
    if (!profile) {
      return {
        sellerId,
        backtrackCount: 0,
        mismatchCount: 0,
        disputeCount: 0,
        completedCount: 0,
        riskScore: '0',
        verificationLevel: 'NORMAL',
        riskNote: '新卖家，暂无历史记录',
      };
    }
    return profile;
  }

  /**
   * 估价师考核：按翻新超预算确认单的估价偏差归因汇总
   * （APPRAISER_UNDERESTIMATE 现场评估不足计入考核；SELLER_MISDESCRIBE 卖家失真；UNFORESEEABLE 不可预见）
   */
  @Roles('OPS', 'ADMIN', 'CS')
  @Get('appraiser-deviations')
  async appraiserDeviations() {
    const overruns = await this.ds.getRepository(RefurbishOverrun).find();
    const users = await this.ds.getRepository(User).find({
      where: { role: 'APPRAISER' },
    });
    const byAppraiser = new Map<
      string,
      {
        appraiserId: string;
        appraiserName: string;
        total: number;
        underestimate: number;
        sellerMisdescribe: number;
        unforeseeable: number;
        pendingSeller: number;
        extraTotal: number;
      }
    >();
    users.forEach((u) =>
      byAppraiser.set(u.id, {
        appraiserId: u.id,
        appraiserName: u.name,
        total: 0,
        underestimate: 0,
        sellerMisdescribe: 0,
        unforeseeable: 0,
        pendingSeller: 0,
        extraTotal: 0,
      }),
    );
    overruns.forEach((o) => {
      let row = byAppraiser.get(o.appraiserId);
      if (!row) {
        row = {
          appraiserId: o.appraiserId,
          appraiserName: '-',
          total: 0,
          underestimate: 0,
          sellerMisdescribe: 0,
          unforeseeable: 0,
          pendingSeller: 0,
          extraTotal: 0,
        };
        byAppraiser.set(o.appraiserId, row);
      }
      row.total += 1;
      row.extraTotal += Number(o.extraTotal);
      if (o.status === 'PENDING_SELLER') row.pendingSeller += 1;
      if (o.deviationCategory === 'APPRAISER_UNDERESTIMATE') row.underestimate += 1;
      else if (o.deviationCategory === 'SELLER_MISDESCRIBE') row.sellerMisdescribe += 1;
      else row.unforeseeable += 1;
    });
    return {
      appraisers: Array.from(byAppraiser.values())
        .filter((r) => r.total > 0 || users.some((u) => u.id === r.appraiserId))
        .map((r) => ({
          ...r,
          extraTotal: Math.round(r.extraTotal * 100) / 100,
          underestimateRatePct: r.total
            ? Math.round((r.underestimate / r.total) * 1000) / 10
            : 0,
        }))
        .sort((a, b) => b.underestimate - a.underestimate),
      generatedAt: new Date(),
    };
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Item,
      Order,
      Delivery,
      Ticket,
      RefurbishOverrun,
      SellerProfile,
      User,
    ]),
  ],
  controllers: [AnalyticsController],
})
export class AnalyticsModule {}
