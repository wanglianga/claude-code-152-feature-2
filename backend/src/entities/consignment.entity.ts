import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/** 家具品类 */
export type FurnitureCategory =
  | 'SOFA' // 沙发
  | 'DINING_TABLE' // 餐桌
  | 'KIDS_BED' // 儿童床
  | 'BOOKCASE' // 书柜
  | 'OFFICE_CHAIR' // 办公椅
  | 'APPLIANCE_CABINET'; // 家电柜

/** 电梯条件 */
export type ElevatorType = 'ELEVATOR' | 'NO_ELEVATOR' | 'WALKUP';

/**
 * 寄卖申请状态：
 * SUBMITTED 待估价 / APPRAISAL_SCHEDULED 已约上门 / APPRAISED 已估价
 * LISTED 已生成商品上架中 / CANCELLED 卖家反悔 / REJECTED 不符合寄卖 /
 * OVERRUN_CANCELLED 翻新超预算后卖家拒绝追加并取消寄卖
 */
export type ConsignmentStatus =
  | 'SUBMITTED'
  | 'APPRAISAL_SCHEDULED'
  | 'APPRAISED'
  | 'LISTED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'OVERRUN_CANCELLED';

@Entity('consignments')
export class Consignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  code: string;

  @Index()
  @Column({ type: 'uuid' })
  sellerId: string;

  @Index()
  @Column({ type: 'varchar', length: 24 })
  category: FurnitureCategory;

  @Column()
  brand: string;

  /** 尺寸，如 220x95x85 cm */
  @Column()
  sizeText: string;

  @Column()
  material: string;

  @Column({ type: 'int' })
  yearsUsed: number;

  /** 瑕疵照片 URL 列表 */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  defectPhotos: string[];

  @Column()
  disassemblable: boolean;

  @Column({ type: 'int' })
  floor: number;

  @Column({ type: 'varchar', length: 16 })
  elevator: ElevatorType;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  expectedPrice: string;

  @Column()
  acceptRefurbish: boolean;

  @Column({ default: '' })
  address: string;

  @Index()
  @Column({ type: 'varchar', length: 24, default: 'SUBMITTED' })
  status: ConsignmentStatus;

  /** 提交申请时系统给出的上门验真等级（引用卖家历史画像）：NORMAL / STRICT */
  @Column({ type: 'varchar', length: 16, default: 'NORMAL' })
  verificationLevel: 'NORMAL' | 'STRICT';

  @Column({ default: '' })
  sellerNote: string;

  @CreateDateColumn()
  createdAt: Date;
}
