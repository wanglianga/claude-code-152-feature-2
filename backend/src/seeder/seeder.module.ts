import { Module, Injectable } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from '../entities/user.entity';
import { SellerProfile } from '../entities/seller-profile.entity';
import { Consignment } from '../entities/consignment.entity';
import { Appraisal } from '../entities/appraisal.entity';
import { Item, ItemWorkLog } from '../entities/item.entity';
import { RefurbishOverrun } from '../entities/refurbish-overrun.entity';
import { Order } from '../entities/order.entity';
import { Delivery } from '../entities/delivery.entity';
import { Ticket, TicketMessage } from '../entities/ticket.entity';
import { Settlement, SettlementEntry } from '../entities/settlement.entity';

const hash = (p: string) => bcrypt.hashSync(p, 10);
const daysAgo = (d: number) => new Date(Date.now() - d * 86400000);

/**
 * 演示数据：8 个角色账号 + 一条完整业务链路样例
 * （在售沙发、严格验真卖家、已成交办公椅、退货沙发+电梯受阻）
 */
@Injectable()
export class SeederService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async seed() {
    const existing = await this.ds.getRepository(User).count();
    if (existing > 0) return;

    const m = this.ds.manager;

    const users = await m.save(User, [
      m.create(User, { username: 'admin', passwordHash: hash('admin123'), name: '平台管理员', role: 'ADMIN' }),
      m.create(User, { username: 'ops', passwordHash: hash('ops123'), name: '运营小周', role: 'OPS' }),
      m.create(User, { username: 'kefu', passwordHash: hash('kefu123'), name: '客服小陈', role: 'CS' }),
      m.create(User, { username: 'gujia', passwordHash: hash('gujia123'), name: '估价师老赵', role: 'APPRAISER' }),
      m.create(User, { username: 'cangguan', passwordHash: hash('cangguan123'), name: '仓库管理员阿海', role: 'WAREHOUSE' }),
      m.create(User, { username: 'fanxin', passwordHash: hash('fanxin123'), name: '翻新师傅老吴', role: 'REFURBISHER' }),
      m.create(User, { username: 'peisong', passwordHash: hash('peisong123'), name: '配送队长小马', role: 'DELIVERY' }),
      m.create(User, { username: 'wangjiayi', passwordHash: hash('seller123'), name: '卖家王阿姨', phone: '13800000001', role: 'SELLER' }),
      m.create(User, { username: 'linfan', passwordHash: hash('seller123'), name: '卖家林反悔', phone: '13800000002', role: 'SELLER' }),
      m.create(User, { username: 'liujing', passwordHash: hash('seller123'), name: '卖家刘静', phone: '13800000003', role: 'SELLER' }),
      m.create(User, { username: 'zhangmai', passwordHash: hash('buyer123'), name: '买家张女士', phone: '13900000001', role: 'BUYER' }),
      m.create(User, { username: 'sunmai', passwordHash: hash('buyer123'), name: '买家孙先生', phone: '13900000002', role: 'BUYER' }),
    ]);
    const byName = Object.fromEntries(users.map((u) => [u.username, u]));

    await m.save(SellerProfile, [
      m.create(SellerProfile, {
        sellerId: byName['wangjiayi'].id,
        completedCount: 1, riskScore: '0', verificationLevel: 'NORMAL',
        riskNote: '履约良好，常规验真',
      }),
      m.create(SellerProfile, {
        sellerId: byName['linfan'].id,
        riskNote: '新卖家，暂无历史记录',
      }),
      m.create(SellerProfile, {
        sellerId: byName['liujing'].id,
        completedCount: 1, riskScore: '0', verificationLevel: 'NORMAL',
        riskNote: '常规验真',
      }),
    ]);

    // ---------- 样例 1：王阿姨的三人沙发，在售 ----------
    const sofaConsignment = await m.save(
      m.create(Consignment, {
        code: 'CN202600001',
        sellerId: byName['wangjiayi'].id,
        category: 'SOFA', brand: '顾家家居 KUKA', sizeText: '220x95x85 cm',
        material: '头层牛皮+实木框架', yearsUsed: 3,
        defectPhotos: ['seed://defect/sofa-arm-scratch.jpg'],
        disassemblable: true, floor: 6, elevator: 'ELEVATOR',
        expectedPrice: '1200.00', acceptRefurbish: true,
        address: '和平小区 3 栋 602', status: 'LISTED',
        verificationLevel: 'NORMAL', sellerNote: '扶手有猫抓痕，其余完好',
      }),
    );
    const sofaAppraisal = await m.save(
      m.create(Appraisal, {
        consignmentId: sofaConsignment.id, appraiserId: byName['gujia'].id,
        structuralScore: 2, stainScore: 2, odorScore: 1, mothScore: 1, warpScore: 1,
        moveDifficulty: 3, consignmentPrice: '980.00', minDealPrice: '800.00',
        commissionRate: '0.1500', estimatedRefurbishCost: '120.00',
        cleaningAdvice: '蒸汽深度清洁皮面，猫抓痕补伤膏处理',
        refurbishSuggestions: '扶手补色+打蜡', matchResult: 'MINOR_DIFF',
        matchNote: '猫抓痕比照片略明显，其余与描述一致',
      }),
    );
    const sofaItem = await m.save(
      m.create(Item, {
        consignmentId: sofaConsignment.id, category: 'SOFA',
        title: '顾家家居 三人位真皮沙发 可拆洗',
        description: '头层牛皮，使用 3 年；已完成深度清洁与扶手补色，结构稳固无异味。电梯房，可拆装，配送范围 30km。',
        status: 'LISTED', location: 'WAREHOUSE', warehouseSlot: 'A-03-12',
        deliveryRadiusKm: 30, listedPrice: '980.00', minDealPrice: '800.00',
        cleaningCost: '60.00', refurbishCost: '80.00',
        photos: ['seed://item/sofa-1.jpg', 'seed://item/sofa-2.jpg'],
        enteredWarehouseAt: daysAgo(12), listedAt: daysAgo(4),
      }),
    );
    await m.save(ItemWorkLog, [
      m.create(ItemWorkLog, { itemId: sofaItem.id, assigneeId: byName['fanxin'].id, type: 'CLEANING', note: '蒸汽深度清洁', cost: '60.00', createdAt: daysAgo(11) }),
      m.create(ItemWorkLog, { itemId: sofaItem.id, assigneeId: byName['fanxin'].id, type: 'REPAINT', note: '扶手补色打蜡', cost: '80.00', createdAt: daysAgo(10) }),
      m.create(ItemWorkLog, { itemId: sofaItem.id, assigneeId: byName['cangguan'].id, type: 'STORAGE', note: 'A-03-12', cost: '0.00', createdAt: daysAgo(12) }),
      m.create(ItemWorkLog, { itemId: sofaItem.id, assigneeId: byName['cangguan'].id, type: 'PHOTOGRAPHY', note: '棚拍 6 张', cost: '0.00', createdAt: daysAgo(5) }),
      m.create(ItemWorkLog, { itemId: sofaItem.id, assigneeId: byName['cangguan'].id, type: 'LISTING_COPY', note: '上架描述', cost: '0.00', createdAt: daysAgo(4) }),
    ]);

    // ---------- 样例 2：刘静的办公椅，已成交并结算（快速周转标杆） ----------
    const chairConsignment = await m.save(
      m.create(Consignment, {
        code: 'CN202600002', sellerId: byName['liujing'].id,
        category: 'OFFICE_CHAIR', brand: '西昊 SIHOO', sizeText: '65x65x115 cm',
        material: '网布+尼龙脚', yearsUsed: 1, defectPhotos: [],
        disassemblable: true, floor: 3, elevator: 'ELEVATOR',
        expectedPrice: '350.00', acceptRefurbish: false,
        address: '科技园公寓', status: 'LISTED', verificationLevel: 'NORMAL',
      }),
    );
    const chairAppraisal = await m.save(
      m.create(Appraisal, {
        consignmentId: chairConsignment.id, appraiserId: byName['gujia'].id,
        structuralScore: 1, stainScore: 1, odorScore: 1, mothScore: 1, warpScore: 1,
        moveDifficulty: 1, consignmentPrice: '300.00', minDealPrice: '240.00',
        commissionRate: '0.1500', estimatedRefurbishCost: '0',
        cleaningAdvice: '常规擦拭即可', refurbishSuggestions: '无需翻新',
        matchResult: 'MATCH',
      }),
    );
    const chairItem = await m.save(
      m.create(Item, {
        consignmentId: chairConsignment.id, category: 'OFFICE_CHAIR',
        title: '西昊人体工学办公椅 95 新',
        description: '使用一年，气压杆正常，网布无破损。',
        status: 'DELIVERED', location: 'WAREHOUSE', warehouseSlot: 'B-01-05',
        deliveryRadiusKm: 30, listedPrice: '300.00', minDealPrice: '240.00',
        enteredWarehouseAt: daysAgo(20), listedAt: daysAgo(18),
      }),
    );
    const chairOrder = await m.save(
      m.create(Order, {
        code: 'OD2026000001', itemId: chairItem.id,
        consignmentId: chairConsignment.id, buyerId: byName['zhangmai'].id,
        sellerId: byName['liujing'].id, dealPrice: '300.00', deliveryFee: '60.00',
        buyerAddress: '幸福里 2 栋 501', buyerFloor: 5, buyerElevator: 'ELEVATOR',
        status: 'SETTLED', createdAt: daysAgo(16),
      }),
    );
    await m.save(
      m.create(Delivery, {
        orderId: chairOrder.id, teamId: byName['peisong'].id,
        vehicleType: 'SMALL_VAN', needsDisassembly: true,
        pickupFloor: 3, pickupElevator: 'ELEVATOR',
        dropoffFloor: 5, dropoffElevator: 'ELEVATOR',
        scheduledWindow: '2026-09-19 上午', status: 'DONE',
        createdAt: daysAgo(17),
      }),
    );
    const chairSettlement = await m.save(
      m.create(Settlement, {
        orderId: chairOrder.id, consignmentId: chairConsignment.id,
        sellerId: byName['liujing'].id, sellerPayout: '249.00', platformIncome: '105.00',
        createdAt: daysAgo(15),
      }),
    );
    await m.save(SettlementEntry, [
      m.create(SettlementEntry, { settlementId: chairSettlement.id, type: 'DEAL_PRICE', amount: '300.00', source: '订单 OD2026000001 成交价（寄卖价 300 / 底价 240）', sourceRefId: chairOrder.id }),
      m.create(SettlementEntry, { settlementId: chairSettlement.id, type: 'COMMISSION', amount: '45.00', source: '平台佣金 = 300 × 15%（估价师估价单）', sourceRefId: chairAppraisal.id }),
      m.create(SettlementEntry, { settlementId: chairSettlement.id, type: 'STORAGE_FEE', amount: '6.00', source: '库位 B-01-05 存放 2 天 × ¥3/天' }),
      m.create(SettlementEntry, { settlementId: chairSettlement.id, type: 'DELIVERY_FEE', amount: '60.00', source: '基础配送费 ¥60（电梯房）' }),
      m.create(SettlementEntry, { settlementId: chairSettlement.id, type: 'SELLER_PAYOUT', amount: '249.00', source: '卖家应得 = 300 - 45 - 6' }),
    ]);

    // ---------- 样例 3：王阿姨的另一张沙发，退货 + 沙发进不了电梯（售后/失败率样例） ----------
    const sofa2 = await m.save(
      m.create(Consignment, {
        code: 'CN202600003', sellerId: byName['wangjiayi'].id,
        category: 'SOFA', brand: '全友 QUANU', sizeText: '240x100x90 cm',
        material: '布艺', yearsUsed: 4, defectPhotos: [],
        disassemblable: false, floor: 2, elevator: 'NO_ELEVATOR',
        expectedPrice: '900.00', acceptRefurbish: true,
        address: '老街自建房', status: 'LISTED', verificationLevel: 'NORMAL',
      }),
    );
    const appraisal2 = await m.save(
      m.create(Appraisal, {
        consignmentId: sofa2.id, appraiserId: byName['gujia'].id,
        structuralScore: 2, stainScore: 3, odorScore: 2, mothScore: 1, warpScore: 2,
        moveDifficulty: 5, consignmentPrice: '760.00', minDealPrice: '600.00',
        commissionRate: '0.1500', estimatedRefurbishCost: '150.00',
        cleaningAdvice: '布套拆洗', refurbishSuggestions: '海绵轻微塌陷，建议加垫',
        matchResult: 'MATCH',
      }),
    );
    const item2 = await m.save(
      m.create(Item, {
        consignmentId: sofa2.id, category: 'SOFA',
        title: '全友四人位布艺沙发（不可拆装）',
        description: '布套可拆洗，需注意搬运尺寸。',
        status: 'RETURNED', location: 'WAREHOUSE', warehouseSlot: 'A-05-01',
        deliveryRadiusKm: 20, listedPrice: '760.00', minDealPrice: '600.00',
        cleaningCost: '50.00', refurbishCost: '120.00',
        enteredWarehouseAt: daysAgo(9), listedAt: daysAgo(6),
      }),
    );
    const order2 = await m.save(
      m.create(Order, {
        code: 'OD2026000002', itemId: item2.id, consignmentId: sofa2.id,
        buyerId: byName['sunmai'].id, sellerId: byName['wangjiayi'].id,
        dealPrice: '760.00', deliveryFee: '140.00',
        buyerAddress: '梧桐苑 7 栋 902', buyerFloor: 9, buyerElevator: 'ELEVATOR',
        needOldFurnitureRemoval: false, status: 'RETURNED',
        deliveryNote: '轿厢进深仅 1.4m，沙发 2.4m 无法进梯', createdAt: daysAgo(5),
      }),
    );
    await m.save(
      m.create(Delivery, {
        orderId: order2.id, teamId: byName['peisong'].id,
        vehicleType: 'MID_TRUCK', needsDisassembly: false,
        pickupFloor: 2, pickupElevator: 'NO_ELEVATOR',
        dropoffFloor: 9, dropoffElevator: 'ELEVATOR',
        scheduledWindow: '2026-09-30 下午', status: 'FAILED',
        failReason: 'ELEVATOR_TOO_SMALL',
        failNote: '买家小区电梯进深 1.4m，沙发不可拆装，楼梯转角也无法通过',
        createdAt: daysAgo(6),
      }),
    );
    const ticket2 = await m.save(
      m.create(Ticket, {
        consignmentId: sofa2.id, itemId: item2.id, orderId: order2.id,
        type: 'ELEVATOR_BLOCK', createdBy: byName['peisong'].id, creatorRole: 'DELIVERY',
        status: 'RESOLVED', resolution: 'RETURN_REFUND', liableParty: 'SHARED',
        compensationAmount: '60.00',
        title: '沙发进不了买家电梯，买家要求退货',
        description: '现场测量电梯进深 1.4m，商品页未标注最小通道尺寸。买家要求退货并补偿往返搬运费。',
        createdAt: daysAgo(4),
      }),
    );
    await m.save(TicketMessage, [
      m.create(TicketMessage, { ticketId: ticket2.id, authorId: byName['sunmai'].id, authorRole: 'BUYER', authorName: '买家孙先生', content: '电梯确实进不去，申请退款。', createdAt: daysAgo(4) }),
      m.create(TicketMessage, { ticketId: ticket2.id, authorId: byName['peisong'].id, authorRole: 'DELIVERY', authorName: '配送队长小马', content: '已尝试立放、吊绳方案均不可行，建议退货。', createdAt: daysAgo(4) }),
      m.create(TicketMessage, { ticketId: ticket2.id, authorId: byName['kefu'].id, authorRole: 'CS', authorName: '客服小陈', content: '裁定退货退款，平台与卖家共担 60 元搬运补偿，商品返仓重新上架需补充通道尺寸。', createdAt: daysAgo(3) }),
    ]);

    // ---------- 样例 4：高风险卖家林反悔：一次反悔 + 一次描述不符；新申请触发 STRICT ----------
    const cancelledC = await m.save(
      m.create(Consignment, {
        code: 'CN202600004', sellerId: byName['linfan'].id,
        category: 'BOOKCASE', brand: '源氏木语', sizeText: '90x35x200 cm',
        material: '白橡木', yearsUsed: 2, defectPhotos: [],
        disassemblable: true, floor: 4, elevator: 'ELEVATOR',
        expectedPrice: '600.00', acceptRefurbish: true,
        status: 'CANCELLED', verificationLevel: 'NORMAL',
        sellerNote: '[卖家反悔] 家人不同意出售', createdAt: daysAgo(30),
      }),
    );
    const mismatchedC = await m.save(
      m.create(Consignment, {
        code: 'CN202600005', sellerId: byName['linfan'].id,
        category: 'DINING_TABLE', brand: '林氏木业', sizeText: '140x80x75 cm',
        material: '板材贴皮', yearsUsed: 1, defectPhotos: ['seed://defect/table-edge.jpg'],
        disassemblable: true, floor: 5, elevator: 'ELEVATOR',
        expectedPrice: '700.00', acceptRefurbish: true,
        status: 'APPRAISED', verificationLevel: 'STRICT', createdAt: daysAgo(10),
      }),
    );
    await m.save(
      m.create(Appraisal, {
        consignmentId: mismatchedC.id, appraiserId: byName['gujia'].id,
        structuralScore: 4, stainScore: 3, odorScore: 3, mothScore: 2, warpScore: 4,
        moveDifficulty: 3, consignmentPrice: '320.00', minDealPrice: '220.00',
        commissionRate: '0.1800', estimatedRefurbishCost: '260.00',
        cleaningAdvice: '贴面起翘需封边', refurbishSuggestions: '板材变形明显，建议仅同城自提',
        matchResult: 'MISMATCH',
        matchNote: '申报"实木几乎全新"，实测贴面板材且边缘变形、有烟味',
        createdAt: daysAgo(9),
      }),
    );
    await m.save(
      m.create(Item, {
        consignmentId: mismatchedC.id, category: 'DINING_TABLE',
        title: '林氏木业 1.4m 餐桌（需翻新）', description: '',
        status: 'PREPARING', location: 'SELLER_HOME', deliveryRadiusKm: 0,
        listedPrice: '320.00', minDealPrice: '220.00',
      }),
    );
    // 高风险卖家的新申请（估价师工作台可见 STRICT 置顶）
    await m.save(
      m.create(Consignment, {
        code: 'CN202600006', sellerId: byName['linfan'].id,
        category: 'KIDS_BED', brand: '松堡王国', sizeText: '200x120x90 cm',
        material: '松木', yearsUsed: 2, defectPhotos: [],
        disassemblable: true, floor: 5, elevator: 'ELEVATOR',
        expectedPrice: '800.00', acceptRefurbish: true,
        address: '城南 12 号院', status: 'SUBMITTED',
        verificationLevel: 'STRICT',
        sellerNote: '孩子长大换新床（系统已标记严格验真）',
      }),
    );
    // 画像按历史重算：反悔 1 次(3分) + 不符 1 次(2分) = 5 分 → STRICT
    await m.update(
      SellerProfile,
      { sellerId: byName['linfan'].id },
      {
        backtrackCount: 1,
        mismatchCount: 1,
        disputeCount: 0,
        completedCount: 0,
        riskScore: '5.00',
        verificationLevel: 'STRICT',
        riskNote: '风险分 5（反悔1/不符1/争议0），新寄卖需严格上门验真',
      },
    );

    // ---------- 样例 5：王阿姨在售书柜（丰富市场） ----------
    const bookC = await m.save(
      m.create(Consignment, {
        code: 'CN202600007', sellerId: byName['wangjiayi'].id,
        category: 'BOOKCASE', brand: '宜家 BILLY', sizeText: '80x28x202 cm',
        material: '刨花板贴膜', yearsUsed: 2, defectPhotos: [],
        disassemblable: true, floor: 6, elevator: 'ELEVATOR',
        expectedPrice: '200.00', acceptRefurbish: false,
        status: 'LISTED', verificationLevel: 'NORMAL',
      }),
    );
    await m.save(
      m.create(Appraisal, {
        consignmentId: bookC.id, appraiserId: byName['gujia'].id,
        structuralScore: 2, stainScore: 1, odorScore: 1, mothScore: 1, warpScore: 2,
        moveDifficulty: 2, consignmentPrice: '150.00', minDealPrice: '100.00',
        commissionRate: '0.1500', estimatedRefurbishCost: '0',
        cleaningAdvice: '擦拭即可', refurbishSuggestions: '无', matchResult: 'MATCH',
      }),
    );
    await m.save(
      m.create(Item, {
        consignmentId: bookC.id, category: 'BOOKCASE',
        title: '宜家 BILLY 书柜 80cm 白色',
        description: '可拆装，层板完好，无明显划痕。仅支持同城自提或短途配送 10km。',
        status: 'LISTED', location: 'WAREHOUSE', warehouseSlot: 'C-02-08',
        deliveryRadiusKm: 10, listedPrice: '150.00', minDealPrice: '100.00',
        enteredWarehouseAt: daysAgo(3), listedAt: daysAgo(1),
      }),
    );

    // ---------- 样例 6：王阿姨的餐桌，清洁发现划痕比估价严重，超预算待卖家确认 ----------
    const tableC = await m.save(
      m.create(Consignment, {
        code: 'CN202600008', sellerId: byName['wangjiayi'].id,
        category: 'DINING_TABLE', brand: '源氏木语', sizeText: '140x80x75 cm',
        material: '白橡木实木', yearsUsed: 4,
        defectPhotos: ['seed://defect/table-light-scratch.jpg'],
        disassemblable: true, floor: 3, elevator: 'ELEVATOR',
        expectedPrice: '1000.00', acceptRefurbish: true,
        address: '和平小区 3 栋 602', status: 'APPRAISED',
        verificationLevel: 'NORMAL',
        sellerNote: '桌面有日常使用轻微划痕，不明显',
      }),
    );
    const tableAppraisal = await m.save(
      m.create(Appraisal, {
        consignmentId: tableC.id, appraiserId: byName['gujia'].id,
        structuralScore: 2, stainScore: 2, odorScore: 1, mothScore: 1, warpScore: 2,
        moveDifficulty: 2, consignmentPrice: '880.00', minDealPrice: '700.00',
        commissionRate: '0.1500', estimatedRefurbishCost: '150.00',
        cleaningAdvice: '桌面轻度抛光打蜡', refurbishSuggestions: '局部补漆即可',
        matchResult: 'MINOR_DIFF',
        matchNote: '卖家照片光线较强，现场看划痕比照片略多，按局部补漆估价',
        createdAt: daysAgo(3),
      }),
    );
    const tableItem = await m.save(
      m.create(Item, {
        consignmentId: tableC.id, category: 'DINING_TABLE',
        title: '源氏木语 1.4m 白橡木实木餐桌',
        description: '', status: 'OVERRUN_PENDING', location: 'WAREHOUSE',
        warehouseSlot: 'A-02-07', deliveryRadiusKm: 30,
        listedPrice: '880.00', minDealPrice: '700.00',
        cleaningCost: '40.00', refurbishCost: '60.00', approvedOverrunCost: '0.00',
        photos: [], archivedInternalPhotos: ['seed://defect/table-light-scratch.jpg'],
        enteredWarehouseAt: daysAgo(2),
      }),
    );
    await m.save(ItemWorkLog, [
      m.create(ItemWorkLog, { itemId: tableItem.id, assigneeId: byName['fanxin'].id, type: 'CLEANING', note: '桌面深度清洁去油', cost: '40.00', createdAt: daysAgo(2) }),
      m.create(ItemWorkLog, { itemId: tableItem.id, assigneeId: byName['fanxin'].id, type: 'REPAINT', note: '尝试局部补漆（无法覆盖深层划痕）', cost: '60.00', createdAt: daysAgo(1) }),
      m.create(ItemWorkLog, { itemId: tableItem.id, assigneeId: byName['cangguan'].id, type: 'STORAGE', note: 'A-02-07', cost: '0.00', createdAt: daysAgo(2) }),
    ]);
    await m.save(
      m.create(RefurbishOverrun, {
        code: 'RO202600001', consignmentId: tableC.id, itemId: tableItem.id,
        appraisalId: tableAppraisal.id, appraiserId: byName['gujia'].id,
        createdById: byName['fanxin'].id, creatorRole: 'REFURBISHER',
        reason: '仓库清洁时发现餐桌表面划痕比估价时严重：划痕已渗透漆膜且分布于整个桌面，局部补漆无法覆盖，需要整体重新打磨上漆（两底两面）。',
        discoveryPhotos: ['seed://defect/table-scratch-deep-1.jpg', 'seed://defect/table-scratch-deep-2.jpg'],
        extraLaborCost: '180.00', extraMaterialCost: '120.00', extraTotal: '300.00',
        extraSpentCost: '0.00',
        budgetedRefurbishCost: '150.00', incurredRefurbishCost: '100.00',
        currentListedPrice: '880.00', suggestedPrice: '850.00',
        priceImpactNote: '整体打磨上漆后成色明显提升，建议维持 880 上架；若急于出手可按 850 挂牌，预计售价变化约 -3%。',
        delayDays: 3, listingImpact: 'DELAY',
        status: 'PENDING_SELLER',
        deviationCategory: 'APPRAISER_UNDERESTIMATE',
        deviationNote: '估价现场在卖家强光下未能识别漆面深层划痕，仅按局部补漆估了 150 元；纳入估价师偏差考核，后续实木桌面需在自然光下斜光复检。',
      }),
    );

    // ---------- 样例 7：刘静的家电柜，卖家已接受超预算，翻新后重拍上架（旧照仅内部审计） ----------
    const cabinetC = await m.save(
      m.create(Consignment, {
        code: 'CN202600009', sellerId: byName['liujing'].id,
        category: 'APPLIANCE_CABINET', brand: '林氏木业', sizeText: '120x45x85 cm',
        material: '颗粒板贴皮', yearsUsed: 3,
        defectPhotos: ['seed://defect/cabinet-before.jpg'],
        disassemblable: true, floor: 2, elevator: 'ELEVATOR',
        expectedPrice: '520.00', acceptRefurbish: true,
        address: '科技园公寓', status: 'LISTED', verificationLevel: 'NORMAL',
      }),
    );
    const cabinetAppraisal = await m.save(
      m.create(Appraisal, {
        consignmentId: cabinetC.id, appraiserId: byName['gujia'].id,
        structuralScore: 2, stainScore: 3, odorScore: 1, mothScore: 1, warpScore: 2,
        moveDifficulty: 2, consignmentPrice: '460.00', minDealPrice: '360.00',
        commissionRate: '0.1500', estimatedRefurbishCost: '80.00',
        cleaningAdvice: '擦拭清洁', refurbishSuggestions: '边缘轻微封边',
        matchResult: 'MATCH',
        matchNote: '与描述基本一致', createdAt: daysAgo(8),
      }),
    );
    const cabinetItem = await m.save(
      m.create(Item, {
        consignmentId: cabinetC.id, category: 'APPLIANCE_CABINET',
        title: '林氏木业 1.2m 餐边家电柜（已整体翻新）',
        description: '使用 3 年；翻新后贴皮牢固、封边完整，内部层板无受潮。可拆装，电梯房，配送范围 20km。',
        status: 'LISTED', location: 'WAREHOUSE', warehouseSlot: 'C-04-02',
        deliveryRadiusKm: 20, listedPrice: '460.00', minDealPrice: '360.00',
        cleaningCost: '30.00', refurbishCost: '190.00', approvedOverrunCost: '120.00',
        photos: ['seed://item/cabinet-after-1.jpg', 'seed://item/cabinet-after-2.jpg'],
        archivedInternalPhotos: [
          'seed://defect/cabinet-before.jpg',
          'seed://defect/cabinet-peeling-found.jpg',
        ],
        defectNote: '翻新后状态：顶面右侧曾有贴皮起翘，已整体封边打磨，手感平整；背板有一处 2cm 浅痕已补色，不影响使用。',
        enteredWarehouseAt: daysAgo(7), listedAt: daysAgo(1),
      }),
    );
    const cabinetOverrun = await m.save(
      m.create(RefurbishOverrun, {
        code: 'RO202600002', consignmentId: cabinetC.id, itemId: cabinetItem.id,
        appraisalId: cabinetAppraisal.id, appraiserId: byName['gujia'].id,
        createdById: byName['cangguan'].id, creatorRole: 'WAREHOUSE',
        reason: '清洁后贴皮起翘范围扩大（清洁前被油污覆盖不可见），需重新封边并更换部分老化贴皮。',
        discoveryPhotos: ['seed://defect/cabinet-peeling-found.jpg'],
        extraLaborCost: '80.00', extraMaterialCost: '40.00', extraTotal: '120.00',
        extraSpentCost: '110.00',
        budgetedRefurbishCost: '80.00', incurredRefurbishCost: '80.00',
        currentListedPrice: '460.00', suggestedPrice: '460.00',
        priceImpactNote: '翻新后成色与估价时预期一致，维持 460 上架，不影响售价。',
        delayDays: 2, listingImpact: 'DELAY',
        status: 'ACCEPTED', deviationCategory: 'UNFORESEEABLE',
        deviationNote: '起翘被油污覆盖，上门验真时不可见，不纳入估价师考核。',
        sellerNote: '同意追加预算，尽快翻新上架。',
        sellerDecidedAt: daysAgo(5), photoCompletedAt: daysAgo(2),
        createdAt: daysAgo(6),
      }),
    );
    await m.save(ItemWorkLog, [
      m.create(ItemWorkLog, { itemId: cabinetItem.id, assigneeId: byName['fanxin'].id, type: 'CLEANING', note: '除油清洁', cost: '30.00', createdAt: daysAgo(7) }),
      m.create(ItemWorkLog, { itemId: cabinetItem.id, assigneeId: byName['fanxin'].id, type: 'REPAIR', note: '边缘封边（估价预算内）', cost: '80.00', createdAt: daysAgo(6) }),
      m.create(ItemWorkLog, { itemId: cabinetItem.id, assigneeId: byName['fanxin'].id, type: 'REPAIR', note: `追加翻新：贴皮更换+封边（确认单 ${cabinetOverrun.code}，卖家已确认）`, cost: '110.00', createdAt: daysAgo(4) }),
      m.create(ItemWorkLog, { itemId: cabinetItem.id, assigneeId: byName['cangguan'].id, type: 'STORAGE', note: 'C-04-02', cost: '0.00', createdAt: daysAgo(7) }),
      m.create(ItemWorkLog, { itemId: cabinetItem.id, assigneeId: byName['cangguan'].id, type: 'PHOTOGRAPHY', note: `翻新后重新拍摄 2 张并更新瑕疵说明；翻新前旧照片已归档内部审计（确认单 ${cabinetOverrun.code}）`, cost: '0.00', createdAt: daysAgo(2) }),
      m.create(ItemWorkLog, { itemId: cabinetItem.id, assigneeId: byName['cangguan'].id, type: 'LISTING_COPY', note: '上架描述', cost: '0.00', createdAt: daysAgo(1) }),
    ]);

    // eslint-disable-next-line no-console
    console.log('[seed] 演示数据已写入');
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User, SellerProfile, Consignment, Appraisal, Item, ItemWorkLog,
      RefurbishOverrun,
      Order, Delivery, Ticket, TicketMessage, Settlement, SettlementEntry,
    ]),
  ],
  providers: [SeederService],
  exports: [SeederService],
})
export class SeederModule {}
