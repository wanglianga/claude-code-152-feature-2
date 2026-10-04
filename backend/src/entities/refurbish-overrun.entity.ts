import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * 翻新成本超预算确认单：
 * 清洁/翻新中发现估价时未预见的问题（如餐桌划痕比估价时严重，需整体重新打磨上漆），
 * 仓库把新增工时费、材料费、预计售价变化、是否影响上架时间推给卖家确认。
 *
 * PENDING_SELLER 待卖家确认
 * ACCEPTED 卖家接受：继续翻新，追加费用从成交款扣除
 * REJECTED_REDUCE 卖家拒绝追加翻新：商品按现状降价上架
 * REJECTED_CANCEL 卖家拒绝并取消寄卖：商品下架、寄卖终止
 */
export type RefurbishOverrunStatus =
  | 'PENDING_SELLER'
  | 'ACCEPTED'
  | 'REJECTED_REDUCE'
  | 'REJECTED_CANCEL';

/** 估价偏差归因（保留用于考核估价师） */
export type AppraisalDeviationCategory =
  | 'SELLER_MISDESCRIBE' // 卖家申报隐瞒/失真
  | 'APPRAISER_UNDERESTIMATE' // 估价师现场评估不足
  | 'UNFORESEEABLE'; // 清洁翻新后才显现，现场不可预见

@Entity('refurbish_overruns')
export class RefurbishOverrun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  code: string;

  @Index()
  @Column({ type: 'uuid' })
  consignmentId: string;

  @Index()
  @Column({ type: 'uuid' })
  itemId: string;

  /** 关联估价单（偏差归因考核依据） */
  @Column({ type: 'uuid' })
  appraisalId: string;

  /** 估价师快照（估价单上的 appraiserId） */
  @Index()
  @Column({ type: 'uuid' })
  appraiserId: string;

  @Column({ type: 'uuid' })
  createdById: string;

  @Column({ type: 'varchar', length: 16 })
  creatorRole: string;

  /** 发现说明，如"清洁时发现桌面划痕比估价时严重，需整体重新打磨上漆" */
  @Column({ type: 'text' })
  reason: string;

  /** 发现问题时拍摄的照片（内部留档，不对买家展示） */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  discoveryPhotos: string[];

  /** 新增工时费 */
  @Column({ type: 'numeric', precision: 10, scale: 2, default: '0' })
  extraLaborCost: string;

  /** 新增材料费 */
  @Column({ type: 'numeric', precision: 10, scale: 2, default: '0' })
  extraMaterialCost: string;

  /** 追加预算合计 = 工时 + 材料 */
  @Column({ type: 'numeric', precision: 10, scale: 2, default: '0' })
  extraTotal: string;

  /** 卖家接受后，翻新环节实际登记的追加作业支出（REPAINT/REPAIR 作业累计，受 extraTotal 上限管控） */
  @Column({ type: 'numeric', precision: 10, scale: 2, default: '0' })
  extraSpentCost: string;

  /** 估价时预估翻新成本（快照） */
  @Column({ type: 'numeric', precision: 10, scale: 2, default: '0' })
  budgetedRefurbishCost: string;

  /** 发起时已发生的清洁+翻新费用（快照） */
  @Column({ type: 'numeric', precision: 10, scale: 2, default: '0' })
  incurredRefurbishCost: string;

  /** 发起时挂牌价（快照） */
  @Column({ type: 'numeric', precision: 10, scale: 2, default: '0' })
  currentListedPrice: string;

  /** 平台建议的翻新后售价 */
  @Column({ type: 'numeric', precision: 10, scale: 2, default: '0' })
  suggestedPrice: string;

  /** 预计售价变化说明 */
  @Column({ type: 'text', default: '' })
  priceImpactNote: string;

  /** 预计推迟上架天数，0 表示不影响 */
  @Column({ type: 'int', default: 0 })
  delayDays: number;

  @Column({ type: 'varchar', length: 16, default: 'NO_DELAY' })
  listingImpact: 'DELAY' | 'NO_DELAY';

  @Index()
  @Column({ type: 'varchar', length: 24, default: 'PENDING_SELLER' })
  status: RefurbishOverrunStatus;

  @Index()
  @Column({ type: 'varchar', length: 32, default: 'UNFORESEEABLE' })
  deviationCategory: AppraisalDeviationCategory;

  /** 估价偏差原因说明（平台保留，用于考核估价师） */
  @Column({ type: 'text', default: '' })
  deviationNote: string;

  /** 卖家决定时的留言 */
  @Column({ type: 'text', default: '' })
  sellerNote: string;

  /** 拒绝追加翻新、选择降价上架时的降价后价格 */
  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  reducedPrice: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  sellerDecidedAt: Date | null;

  /** 翻新完成、重新拍摄更新瑕疵说明的时间（旧照片在此节点归档内部审计） */
  @Column({ type: 'timestamptz', nullable: true })
  photoCompletedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
