import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In, Not, IsNull } from 'typeorm';
import { SellerProfile } from '../entities/seller-profile.entity';
import { Consignment } from '../entities/consignment.entity';
import { Appraisal } from '../entities/appraisal.entity';
import { Order } from '../entities/order.entity';
import { Ticket } from '../entities/ticket.entity';

const STRICT_THRESHOLD = 4;

@Injectable()
export class SellerRiskService {
  constructor(
    @InjectRepository(SellerProfile)
    private readonly profiles: Repository<SellerProfile>,
    private readonly dataSource: DataSource,
  ) {}

  async getOrCreate(sellerId: string): Promise<SellerProfile> {
    let profile = await this.profiles.findOne({ where: { sellerId } });
    if (!profile) {
      profile = await this.profiles.save(
        this.profiles.create({
          sellerId,
          riskNote: '新卖家，暂无历史记录',
        }),
      );
    }
    return profile;
  }

  /**
   * 根据历史单据重算卖家画像：
   * - 反悔：进入估价/上架后被取消的寄卖
   * - 描述不符：估价单 MINOR_DIFF / MISMATCH
   * - 售后争议：卖家责任或共担的异常工单
   * - 成交：已送达/已结算订单
   */
  async recalculate(sellerId: string): Promise<SellerProfile> {
    const profile = await this.getOrCreate(sellerId);

    const consignments = await this.dataSource
      .getRepository(Consignment)
      .find({ where: { sellerId } });
    const consignmentIds = consignments.map((c) => c.id);

    const backtrackCount = consignments.filter(
      (c) =>
        c.status === 'CANCELLED' && c.cancelReason !== 'OVERRUN_REJECTED',
    ).length;

    let mismatchCount = 0;
    if (consignmentIds.length) {
      mismatchCount = await this.dataSource.getRepository(Appraisal).count({
        where: {
          consignmentId: In(consignmentIds),
          matchResult: In(['MINOR_DIFF', 'MISMATCH'] as any),
        },
      });
    }

    const completedCount = consignmentIds.length
      ? await this.dataSource.getRepository(Order).count({
          where: {
            sellerId,
            status: In(['DELIVERED', 'SETTLED'] as any),
          },
        })
      : 0;

    const disputeCount = consignmentIds.length
      ? await this.dataSource.getRepository(Ticket).count({
          where: {
            consignmentId: In(consignmentIds),
            liableParty: In(['SELLER', 'SHARED']),
            status: Not(In(['OPEN'] as any)),
          },
        })
      : 0;

    const raw =
      backtrackCount * 3 + mismatchCount * 2 + disputeCount - completedCount * 0.5;
    const riskScore = Math.max(0, Math.round(raw * 100) / 100);
    const verificationLevel =
      riskScore >= STRICT_THRESHOLD || mismatchCount >= 2 ? 'STRICT' : 'NORMAL';

    profile.backtrackCount = backtrackCount;
    profile.mismatchCount = mismatchCount;
    profile.disputeCount = disputeCount;
    profile.completedCount = completedCount;
    profile.riskScore = String(riskScore);
    profile.verificationLevel = verificationLevel;
    profile.riskNote =
      verificationLevel === 'STRICT'
        ? `风险分 ${riskScore}（反悔${backtrackCount}/不符${mismatchCount}/争议${disputeCount}），新寄卖需严格上门验真`
        : `风险分 ${riskScore}，常规验真`;
    return this.profiles.save(profile);
  }
}

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      SellerProfile,
      Consignment,
      Appraisal,
      Order,
      Ticket,
    ]),
  ],
  providers: [SellerRiskService],
  exports: [SellerRiskService],
})
export class RiskModule {}
