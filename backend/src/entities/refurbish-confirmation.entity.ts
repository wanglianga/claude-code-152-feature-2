import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * 翻新成本超预算确认单：
 * 仓库清洁时发现瑕疵比估价时严重（如餐桌划痕需重新打磨上漆），
 * 平台把新增工时、材料费、预计售价变化、是否影响上架时间推给卖家确认。
 *
 * PENDING 待卖家确认
 * ACCEPTED 卖家接受：追加费用计入翻新费，成交后从成交款扣除
 * REJECTED_REDUCE 卖家拒绝，选择降价上架
 * REJECTED_CANCEL 卖家拒绝，取消寄卖（商品下架）
 */
export type OverrunStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'REJECTED_REDUCE'
  | 'REJECTED_CANCEL';

@Entity('refurbish_overrun_confirmations')
export class RefurbishOverrunConfirmation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  code: string;

  @Index()
  @Column({ type: 'uuid' })
  itemId: string;

  @Index()
  @Column({ type: 'uuid' })
  consignmentId: string;

  /** 关联估价单的估价师（超预算即估价偏差，用于考核） */
  @Index()
  @Column({ type: 'uuid' })
  appraiserId: string;

  @Column({ type: 'uuid' })
  createdById: string;

  @Column({ type: 'varchar', length: 16 })
  creatorRole: string;

  /** 发现的问题，如"餐桌表面划痕比估价时严重，需要重新打磨上漆" */
  @Column({ type: 'text' })
  reason: string;

  /** 估价单上的预估翻新成本（快照） */
  @Column({ type: 'numeric', precision: 10, scale: 2, default: '0' })
  estimatedRefurbishCost: string;

  /** 发起时已发生的翻新费（快照） */
  @Column({ type: 'numeric', precision: 10, scale: 2, default: '0' })
  incurredRefurbishCost: string;

  /** 新增工时费 */
  @Column({ type: 'numeric', precision: 10, scale: 2, default: '0' })
  additionalLaborCost: string;

  /** 新增材料费 */
  @Column({ type: 'numeric', precision: 10, scale: 2, default: '0' })
  additionalMaterialCost: string;

  /** 当前挂牌价/寄卖价（快照） */
  @Column({ type: 'numeric', precision: 10, scale: 2, default: '0' })
  currentListedPrice: string;

  /** 翻新后预计售价 */
  @Column({ type: 'numeric', precision: 10, scale: 2, default: '0' })
  revisedListedPrice: string;

  /** 是否影响上架时间 */
  @Column({ default: false })
  affectListing: boolean;

  /** 预计上架延后天数 */
  @Column({ type: 'int', default: 0 })
  listingDelayDays: number;

  /** 翻新前现场照片（发起确认时拍摄，卖家确认可见，结案后仅内部审计可见） */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  beforePhotos: string[];

  /**
   * 估价偏差原因（平台内部保留，用于考核估价师，对卖家不可见），
   * 如"估价时桌面铺有桌垫且光线昏暗，未发现贯穿性划痕"
   */
  @Column({ type: 'text', default: '' })
  deviationReason: string;

  @Index()
  @Column({ type: 'varchar', length: 24, default: 'PENDING' })
  status: OverrunStatus;

  /** 卖家确认/拒绝时的备注 */
  @Column({ type: 'text', default: '' })
  sellerDecisionNote: string;

  @Column({ type: 'timestamptz', nullable: true })
  sellerDecidedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
