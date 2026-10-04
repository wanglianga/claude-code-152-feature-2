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
 * PREPARING 清洁翻新中 / PHOTOGRAPHY 拍照中 / LISTED 在售 /
 * RESERVED 已被下单锁定 / SOLD 已成交 / DELIVERED 已交付 /
 * RETURNED 退货 / OFF_SHELF 下架
 */
export type ItemStatus =
  | 'PREPARING'
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

  @Column({ type: 'jsonb', default: () => "'[]'" })
  photos: string[];

  /**
   * 翻新前旧照片归档：仅内部审计可见，买家/卖家不可见。
   * 翻新完成重新拍摄后，原 photos 被移入此处。
   */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  archivedPhotos: string[];

  /**
   * 当前对外瑕疵说明（翻新后的真实状态），买家看到的内容。
   */
  @Column({ type: 'text', default: '' })
  defectNote: string;

  /**
   * 翻新前瑕疵说明归档：仅保留在内部审计记录中。
   */
  @Column({ type: 'text', default: '' })
  archivedDefectNote: string;

  /** 最近一次翻新（含超预算追加作业）完成时间 */
  @Column({ type: 'timestamptz', nullable: true })
  refurbishedAt: Date | null;

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
