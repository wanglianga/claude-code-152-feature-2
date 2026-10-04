import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/** 商品所在：仓库 / 仍在卖家家中（同城自提或卖家仓直发） */
export type StockLocation = 'WAREHOUSE' | 'SELLER_HOME';

/**
 * 商品状态：
 * PREPARING 清洁翻新中 / OVERRUN_PENDING 翻新超预算待卖家确认 /
 * PHOTOGRAPHY 拍照中 / LISTED 在售 /
 * RESERVED 已被下单锁定 / SOLD 已成交 / DELIVERED 已交付 /
 * RETURNED 退货 / OFF_SHELF 下架
 */
export type ItemStatus =
  | 'PREPARING'
  | 'OVERRUN_PENDING'
  | 'PHOTOGRAPHY'
  | 'LISTED'
  | 'RESERVED'
  | 'SOLD'
  | 'DELIVERED'
  | 'RETURNED'
  | 'OFF_SHELF';

@Entity('items')
export class Item {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'uuid' })
  consignmentId: string;

  @Index()
  @Column({ type: 'varchar', length: 24 })
  category: string;

  @Column()
  title: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Index()
  @Column({ type: 'varchar', length: 16, default: 'PREPARING' })
  status: ItemStatus;

  @Column({ type: 'varchar', length: 16, default: 'WAREHOUSE' })
  location: StockLocation;

  /** 仓库库位，如 A-03-12 */
  @Column({ default: '' })
  warehouseSlot: string;

  /** 可配送范围（公里），0 表示仅同城自提 */
  @Column({ type: 'int', default: 0 })
  deliveryRadiusKm: number;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  listedPrice: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: '0' })
  minDealPrice: string;

  /** 实际清洁费 */
  @Column({ type: 'numeric', precision: 10, scale: 2, default: '0' })
  cleaningCost: string;

  /** 实际翻新费（补漆/维修等） */
  @Column({ type: 'numeric', precision: 10, scale: 2, default: '0' })
  refurbishCost: string;

  /**
   * 卖家已确认接受的超预算追加费用（翻新超预算确认单 ACCEPTED 时累计）。
   * 结算时与 refurbishCost 一并从成交款扣除。
   */
  @Column({ type: 'numeric', precision: 10, scale: 2, default: '0' })
  approvedOverrunCost: string;

  /**
   * 翻新前/估价阶段旧照片的内部审计归档（含卖家瑕疵照片与超预算发现照片）。
   * 翻新完成重新拍摄后，对外只展示 photos（翻新后真实状态），
   * 旧照片仅仓库/估价师/客服/运营等内部角色在审计视图可见，买家不可见。
   */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  archivedInternalPhotos: string[];

  /** 翻新后更新的瑕疵说明（买家可见的真实状态描述） */
  @Column({ type: 'text', default: '' })
  defectNote: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  photos: string[];

  @Column({ type: 'timestamptz', nullable: true })
  enteredWarehouseAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  listedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}

/** 翻新/上架作业记录：清洁、补漆、拍照、上架描述等 */
export type WorkLogType =
  | 'CLEANING'
  | 'REPAINT'
  | 'REPAIR'
  | 'PHOTOGRAPHY'
  | 'LISTING_COPY'
  | 'STORAGE';

@Entity('item_work_logs')
export class ItemWorkLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  itemId: string;

  @Column({ type: 'uuid', nullable: true })
  assigneeId: string | null;

  @Column({ type: 'varchar', length: 16 })
  type: WorkLogType;

  @Column({ default: '' })
  note: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: '0' })
  cost: string;

  @CreateDateColumn()
  createdAt: Date;
}
