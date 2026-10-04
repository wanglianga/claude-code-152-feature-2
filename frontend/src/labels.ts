export const CATEGORY: Record<string, string> = {
  SOFA: '沙发',
  DINING_TABLE: '餐桌',
  KIDS_BED: '儿童床',
  BOOKCASE: '书柜',
  OFFICE_CHAIR: '办公椅',
  APPLIANCE_CABINET: '家电柜',
};

export const ELEVATOR: Record<string, string> = {
  ELEVATOR: '有电梯',
  NO_ELEVATOR: '无电梯',
  WALKUP: '楼梯房',
};

export const CONSIGNMENT_STATUS: Record<string, { label: string; cls: string }> = {
  SUBMITTED: { label: '待估价', cls: 'amber' },
  APPRAISAL_SCHEDULED: { label: '已约上门', cls: 'cyan' },
  APPRAISED: { label: '已估价', cls: 'blue' },
  LISTED: { label: '已上架', cls: 'green' },
  CANCELLED: { label: '卖家反悔', cls: 'red' },
  REJECTED: { label: '拒收', cls: 'gray' },
  OVERRUN_CANCELLED: { label: '超预算取消寄卖', cls: 'red' },
};

export const ITEM_STATUS: Record<string, { label: string; cls: string }> = {
  PREPARING: { label: '清洁翻新中', cls: 'amber' },
  OVERRUN_PENDING: { label: '超预算待卖家确认', cls: 'red' },
  PHOTOGRAPHY: { label: '拍照中', cls: 'cyan' },
  LISTED: { label: '在售', cls: 'green' },
  RESERVED: { label: '已锁定', cls: 'blue' },
  SOLD: { label: '已售出', cls: 'purple' },
  DELIVERED: { label: '已交付', cls: 'green' },
  RETURNED: { label: '已退货', cls: 'red' },
  OFF_SHELF: { label: '已下架', cls: 'gray' },
};

export const OVERRUN_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING_SELLER: { label: '待卖家确认', cls: 'red' },
  ACCEPTED: { label: '卖家已接受', cls: 'green' },
  REJECTED_REDUCE: { label: '拒绝追加·降价上架', cls: 'amber' },
  REJECTED_CANCEL: { label: '拒绝·取消寄卖', cls: 'gray' },
};

export const DEVIATION_CATEGORY: Record<string, { label: string; cls: string }> = {
  SELLER_MISDESCRIBE: { label: '卖家申报失真', cls: 'amber' },
  APPRAISER_UNDERESTIMATE: { label: '估价师现场低估', cls: 'red' },
  UNFORESEEABLE: { label: '不可预见（清洁后显现）', cls: 'green' },
};

export const ORDER_STATUS: Record<string, { label: string; cls: string }> = {
  CREATED: { label: '待排班', cls: 'amber' },
  DELIVERY_SCHEDULED: { label: '已预约配送', cls: 'cyan' },
  IN_DELIVERY: { label: '配送中', cls: 'blue' },
  DELIVERED: { label: '已送达', cls: 'purple' },
  SETTLED: { label: '已结算', cls: 'green' },
  CANCELLED: { label: '已取消', cls: 'gray' },
  RETURNING: { label: '退货中', cls: 'red' },
  RETURNED: { label: '已退货', cls: 'red' },
};

export const DELIVERY_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: '待安排', cls: 'amber' },
  SCHEDULED: { label: '已排班', cls: 'cyan' },
  LOADED: { label: '已装车', cls: 'blue' },
  DONE: { label: '已完成', cls: 'green' },
  FAILED: { label: '配送失败', cls: 'red' },
};

export const FAIL_REASON: Record<string, string> = {
  ELEVATOR_TOO_SMALL: '进不了电梯',
  STAIR_TOO_NARROW: '楼道过窄',
  BUYER_ABSENT: '买家不在',
  TRANSIT_DAMAGE: '途中磕碰',
  VEHICLE_UNAVAILABLE: '车辆不足',
  SELLER_BACKTRACK: '卖家反悔无法提货',
  NONE: '-',
};

export const TICKET_TYPE: Record<string, string> = {
  SELLER_BACKTRACK: '卖家临时反悔',
  APPRAISAL_MISMATCH: '估价与实物不符',
  REFURBISH_OVERRUN: '翻新成本超预期',
  COLOR_DIFFERENCE: '色差争议',
  ELEVATOR_BLOCK: '沙发进不了电梯',
  TRANSIT_DAMAGE: '配送途中磕碰',
  RETURN_REQUEST: '售后退货',
  OTHER: '其他',
};

export const TICKET_STATUS: Record<string, { label: string; cls: string }> = {
  OPEN: { label: '处理中', cls: 'amber' },
  RESOLVED: { label: '已裁定', cls: 'green' },
  CLOSED: { label: '已关闭', cls: 'gray' },
};

export const RESOLUTION: Record<string, string> = {
  PENDING: '待处理',
  KEEP_LISTING: '维持上架',
  REDUCE_PRICE: '降价处理',
  SELLER_COMPENSATE: '卖家赔付',
  PLATFORM_COMPENSATE: '平台赔付',
  RETURN_REFUND: '退货退款',
  RE_LIST: '退货返仓重新上架',
  CANCEL_CONSIGNMENT: '终止寄卖',
};

export const ROLE: Record<string, string> = {
  SELLER: '卖家',
  BUYER: '买家',
  APPRAISER: '估价师',
  WAREHOUSE: '仓库管理',
  REFURBISHER: '翻新师',
  DELIVERY: '配送团队',
  CS: '客服',
  OPS: '运营',
  ADMIN: '管理员',
};

export const ROLE_COLOR: Record<string, string> = {
  SELLER: 'blue',
  BUYER: 'green',
  APPRAISER: 'purple',
  WAREHOUSE: 'cyan',
  REFURBISHER: 'cyan',
  DELIVERY: 'amber',
  CS: 'red',
  OPS: 'purple',
  ADMIN: 'gray',
};

export const MATCH_RESULT: Record<string, { label: string; cls: string }> = {
  MATCH: { label: '与描述相符', cls: 'green' },
  MINOR_DIFF: { label: '轻微不符', cls: 'amber' },
  MISMATCH: { label: '严重不符', cls: 'red' },
};

export const WORK_LOG_TYPE: Record<string, string> = {
  CLEANING: '清洁',
  REPAINT: '补漆',
  REPAIR: '维修',
  PHOTOGRAPHY: '拍照',
  LISTING_COPY: '上架文案',
  STORAGE: '入库/库位',
};

export const SETTLEMENT_TYPE: Record<string, string> = {
  DEAL_PRICE: '成交价',
  COMMISSION: '平台佣金',
  REFURBISH_FEE: '清洁翻新费',
  STORAGE_FEE: '仓储费',
  DELIVERY_FEE: '配送费',
  COMPENSATION: '售后赔付/退款',
  SELLER_PAYOUT: '卖家应得',
};
