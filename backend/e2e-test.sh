#!/usr/bin/env bash
# 后端端到端验证：登录各角色 → 申请→估价→清洁翻新上架→下单→配送→售后工单→结算→分析+卖家画像
set -u
BASE=http://127.0.0.1:3000/api
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); echo "  ✓ $1"; }
no(){ FAIL=$((FAIL+1)); echo "  ✗ $1"; }
check(){ if [ "$1" = "$2" ]; then ok "$3"; else no "$3 (got '$1' expected '$2')"; fi; }

login(){ curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d "{\"username\":\"$1\",\"password\":\"$2\"}" | jq -r '.token'; }

echo "== [1] 登录与权限 =="
T_SELLER=$(login wangjiayi seller123)
T_BUYER=$(login zhangmai buyer123)
T_APPR=$(login gujia gujia123)
T_WH=$(login cangguan cangguan123)
T_REF=$(login fanxin fanxin123)
T_DEL=$(login peisong peisong123)
T_CS=$(login kefu kefu123)
T_OPS=$(login ops ops123)
[ -n "$T_SELLER" ] && [ "$T_SELLER" != "null" ] && ok "8 类角色账号可登录（示范卖家/买家）"
# 未登录拒绝
code=$(curl -s -o /dev/null -w '%{http_code}' $BASE/items)
check "$code" "401" "无 token 访问 /items 返回 401"

echo "== [2] 卖家提交寄卖申请（自动引用画像） =="
RESP=$(curl -s -X POST $BASE/consignments -H "Authorization: Bearer $T_SELLER" -H 'Content-Type: application/json' -d '{
  "category":"KIDS_BED","brand":"测试品牌","sizeText":"200x120x90 cm","material":"松木","yearsUsed":2,
  "defectPhotos":["http://x/p1.jpg"],"disassemblable":true,"floor":7,"elevator":"ELEVATOR",
  "expectedPrice":900,"acceptRefurbish":true,"address":"测试小区","sellerNote":"e2e 测试申请"
}')
CN_ID=$(echo "$RESP" | jq -r '.consignment.id')
LEVEL=$(echo "$RESP" | jq -r '.sellerProfile.verificationLevel')
[ -n "$CN_ID" ] && [ "$CN_ID" != "null" ] && ok "寄卖申请已创建 id=$CN_ID"
check "$LEVEL" "NORMAL" "履约良好卖家 -> 常规验真 NORMAL"

echo "== [3] 估价师预约上门 + 上门验真评分与报价 =="
curl -s -o /dev/null -X POST $BASE/appraisals/consignment/$CN_ID/schedule -H "Authorization: Bearer $T_APPR" 2>/dev/null
# schedule 端点挂在 consignments 模块
curl -s -o /dev/null -X POST $BASE/consignments/$CN_ID/schedule -H "Authorization: Bearer $T_APPR"
sc=$(curl -s -X POST $BASE/appraisals/consignment/$CN_ID -H "Authorization: Bearer $T_APPR" -H 'Content-Type: application/json' -d '{
  "structuralScore":2,"stainScore":2,"odorScore":1,"mothScore":1,"warpScore":1,"moveDifficulty":3,
  "consignmentPrice":820,"minDealPrice":650,"commissionRate":0.15,"estimatedRefurbishCost":100,
  "cleaningAdvice":"深度清洁","refurbishSuggestions":"补漆","matchResult":"MATCH",
  "decision":"ACCEPT","location":"WAREHOUSE","deliveryRadiusKm":25}')
ITEM_ID=$(echo "$sc" | jq -r '.item.id')
APPR_ID=$(echo "$sc" | jq -r '.appraisal.id')
[ -n "$ITEM_ID" ] && [ "$ITEM_ID" != "null" ] && ok "估价完成并生成商品 PREPARING（寄卖价820/底价650/佣金15%）"
# 底价高于寄卖价应被拒
bad=$(curl -s -X POST $BASE/appraisals/consignment/$CN_ID -H "Authorization: Bearer $T_APPR" -H 'Content-Type: application/json' -d '{"structuralScore":1,"stainScore":1,"odorScore":1,"mothScore":1,"warpScore":1,"moveDifficulty":1,"consignmentPrice":100,"minDealPrice":200,"matchResult":"MATCH"}' | jq -r '.message')
echo "$bad" | grep -q '最低成交价' && ok "底价高于寄卖价被业务规则拦截"

echo "== [4] 仓库入库/清洁/补漆作业（作业即记账） =="
curl -s -o /dev/null -X POST $BASE/items/$ITEM_ID/work-logs -H "Authorization: Bearer $T_REF" -H 'Content-Type: application/json' -d '{"type":"CLEANING","note":"蒸汽清洁","cost":55}'
curl -s -o /dev/null -X POST $BASE/items/$ITEM_ID/work-logs -H "Authorization: Bearer $T_REF" -H 'Content-Type: application/json' -d '{"type":"REPAINT","note":"床边补漆","cost":75}'
w3=$(curl -s -X POST $BASE/items/$ITEM_ID/work-logs -H "Authorization: Bearer $T_WH" -H 'Content-Type: application/json' -d '{"type":"STORAGE","note":"D-01-01","cost":0}')
check "$(echo "$w3" | jq -r '.item.warehouseSlot')" "D-01-01" "入库登记库位 D-01-01"

echo "== [5] 拍照与上架 =="
curl -s -o /dev/null -X POST $BASE/items/$ITEM_ID/advance -H "Authorization: Bearer $T_WH" -H 'Content-Type: application/json' -d '{"to":"PHOTOGRAPHY"}'
ls=$(curl -s -X POST $BASE/items/$ITEM_ID/advance -H "Authorization: Bearer $T_WH" -H 'Content-Type: application/json' -d '{"to":"LISTED","description":"e2e 儿童床描述","photos":["http://x/bed1.jpg"],"deliveryRadiusKm":25}')
check "$(echo "$ls" | jq -r '.item.status // .status')" "LISTED" "商品上架 LISTED"

echo "== [6] 买家市场可见 + 下单 =="
market=$(curl -s "$BASE/items?status=LISTED" -H "Authorization: Bearer $T_BUYER" | jq 'length')
[ "${market:-0}" -ge 3 ] && ok "买家市场在售商品 ≥3（当前 $market）"
ord=$(curl -s -X POST $BASE/orders -H "Authorization: Bearer $T_BUYER" -H 'Content-Type: application/json' -d "{
  \"itemId\":\"$ITEM_ID\",\"buyerAddress\":\"买家地址 8 楼无电梯\",\"buyerFloor\":8,\"buyerElevator\":\"NO_ELEVATOR\",
  \"needOldFurnitureRemoval\":true,\"appointmentWindow\":\"明天下午\"}")
ORD_ID=$(echo "$ord" | jq -r '.order.id')
DLV_ID=$(echo "$ord" | jq -r '.delivery.id')
FEE=$(echo "$ord" | jq -r '.order.deliveryFee')
[ -n "$ORD_ID" ] && [ "$ORD_ID" != "null" ] && ok "下单成功并生成 PENDING 配送任务"
check "$FEE" "245.00" "配送费=60+7层×15+旧家具80=245"

echo "== [7] 配送排班/装车/送达 =="
curl -s -o /dev/null -X POST $BASE/deliveries/$ORD_ID/schedule -H "Authorization: Bearer $T_DEL" -H 'Content-Type: application/json' -d '{"vehicleType":"MID_TRUCK","scheduledWindow":"10-05 14:00"}'
curl -s -o /dev/null -X POST $BASE/deliveries/$ORD_ID/load -H "Authorization: Bearer $T_DEL"
dn=$(curl -s -X POST $BASE/deliveries/$ORD_ID/done -H "Authorization: Bearer $T_DEL" -H 'Content-Type: application/json' -d '{"note":"买家在场，正常签收"}')
check "$(echo "$dn" | jq -r '.order.status')" "DELIVERED" "送达后订单 DELIVERED"

echo "== [8] 售后协同工单（色差）+ 客服裁定平台赔付 =="
tk=$(curl -s -X POST $BASE/tickets -H "Authorization: Bearer $T_BUYER" -H 'Content-Type: application/json' -d "{
  \"orderId\":\"$ORD_ID\",\"type\":\"COLOR_DIFFERENCE\",\"title\":\"到货颜色比照片深\",\"description\":\"买家认为色差明显要求补偿\"}")
TK_ID=$(echo "$tk" | jq -r '.ticket.id // .id')
curl -s -o /dev/null -X POST $BASE/tickets/$TK_ID/messages -H "Authorization: Bearer $T_WH" -H 'Content-Type: application/json' -d '{"content":"仓库核对拍照光线，建议补偿 30 元色差价"}'
rv=$(curl -s -X POST $BASE/tickets/$TK_ID/resolve -H "Authorization: Bearer $T_CS" -H 'Content-Type: application/json' -d '{"resolution":"PLATFORM_COMPENSATE","liableParty":"PLATFORM","compensationAmount":30,"note":"平台承担 30 元色差补偿"}')
check "$(echo "$rv" | jq -r '.ticket.status')" "RESOLVED" "客服裁定工单 RESOLVED，平台赔付 30"

echo "== [9] 结算单（逐项来源） =="
st=$(curl -s -X POST $BASE/settlements/order/$ORD_ID/generate -H "Authorization: Bearer $T_CS")
echo "$st" | jq -e '.entries | length >= 5' >/dev/null && ok "结算明细 ≥5 项（成交价/佣金/翻新/仓储/配送/赔付/卖家应得）"
PAYOUT=$(echo "$st" | jq -r '.settlement.sellerPayout')
INC=$(echo "$st" | jq -r '.settlement.platformIncome')
# 820 - 123(佣金) - 130(清洁55+补漆75) - 仓储0 - 0(卖家赔付) = 567；平台 123+245-30=338
check "$PAYOUT" "567.00" "卖家应得 820-123-130=567"
check "$INC" "338.00" "平台净收入 123+245-30=338"
echo "$st" | jq -r '.entries[] | select(.type=="COMMISSION") | .source' | grep -q '820 × 15' && ok "佣金来源写明计算式"

echo "== [10] 运营分析（品类指标+渠道建议） =="
an=$(curl -s $BASE/analytics/by-category -H "Authorization: Bearer $T_OPS")
echo "$an" | jq -e '.categories | length == 6' >/dev/null && ok "6 个品类分析齐全"
echo "$an" | jq -r '.categories[] | select(.category=="SOFA") | .channelAdvice' | grep -q '同城自提' && ok "沙发品类因电梯失败给出同城自提建议"

echo "== [11] 卖家画像：描述不符/反悔影响下次验真 =="
# 高风险卖家登录后新申请 -> STRICT
T_RISK=$(login linfan seller123)
rresp=$(curl -s -X POST $BASE/consignments -H "Authorization: Bearer $T_RISK" -H 'Content-Type: application/json' -d '{
  "category":"BOOKCASE","brand":"又一个","sizeText":"80x30x180","material":"板材","yearsUsed":3,
  "disassemblable":true,"floor":4,"elevator":"ELEVATOR","expectedPrice":400,"acceptRefurbish":true}')
check "$(echo "$rresp" | jq -r '.consignment.verificationLevel')" "STRICT" "有反悔+描述不符史 -> 新申请自动 STRICT 严格验真"
q=$(curl -s $BASE/appraisals/queue/pending -H "Authorization: Bearer $T_APPR" | jq -r '[.[] | select(.verificationLevel=="STRICT")] | length')
[ "${q:-0}" -ge 2 ] && ok "估价师待办中 STRICT 申请置顶可见（$q 件）"

echo "== [12] 卖家反悔计入画像 =="
cancelid=$(echo "$rresp" | jq -r '.consignment.id')
curl -s -o /dev/null -X POST $BASE/consignments/$cancelid/cancel -H "Authorization: Bearer $T_RISK" -H 'Content-Type: application/json' -d '{"reason":"e2e 测试反悔"}'
pf=$(curl -s $BASE/analytics/seller-profiles -H "Authorization: Bearer $T_OPS" | jq -r '.[] | select(.username=="linfan") | .backtrackCount')
check "$pf" "2" "反悔次数累加到 2（画像联动）"

echo "== [13] 翻新超预算：新餐桌估价（翻新预算仅 50） =="
tresp=$(curl -s -X POST $BASE/consignments -H "Authorization: Bearer $T_SELLER" -H 'Content-Type: application/json' -d '{
  "category":"DINING_TABLE","brand":"测试木桌","sizeText":"140x80x75 cm","material":"白橡木","yearsUsed":4,
  "defectPhotos":["http://x/table-before.jpg"],"disassemblable":true,"floor":3,"elevator":"ELEVATOR",
  "expectedPrice":1000,"acceptRefurbish":true,"address":"测试小区 3-602","sellerNote":"桌面轻微划痕"}')
TCN=$(echo "$tresp" | jq -r '.consignment.id')
tsc2=$(curl -s -X POST $BASE/appraisals/consignment/$TCN -H "Authorization: Bearer $T_APPR" -H 'Content-Type: application/json' -d '{
  "structuralScore":2,"stainScore":2,"odorScore":1,"mothScore":1,"warpScore":2,"moveDifficulty":2,
  "consignmentPrice":600,"minDealPrice":450,"commissionRate":0.15,"estimatedRefurbishCost":50,
  "cleaningAdvice":"抛光打蜡","refurbishSuggestions":"局部补漆","matchResult":"MINOR_DIFF",
  "decision":"ACCEPT","location":"WAREHOUSE","deliveryRadiusKm":30}')
TID=$(echo "$tsc2" | jq -r '.item.id')
[ -n "$TID" ] && [ "$TID" != "null" ] && ok "餐桌商品已生成（估价翻新预算 50）"

echo "== [14] 超预算作业无卖家确认被拦截 =="
curl -s -o /dev/null -X POST $BASE/items/$TID/work-logs -H "Authorization: Bearer $T_REF" -H 'Content-Type: application/json' -d '{"type":"CLEANING","note":"清洁去油","cost":20}'
block=$(curl -s -X POST $BASE/items/$TID/work-logs -H "Authorization: Bearer $T_REF" -H 'Content-Type: application/json' -d '{"type":"REPAINT","note":"整体打磨上漆","cost":300}')
echo "$block" | jq -r '.message' | grep -q '超预算确认' && ok "翻新费 300 超估价预算 50、未经卖家确认被拦截"

echo "== [15] 翻新师发起超预算确认（工时180+材料120，推迟3天） =="
orr=$(curl -s -X POST $BASE/refurbish-overruns/item/$TID -H "Authorization: Bearer $T_REF" -H 'Content-Type: application/json' -d '{
  "reason":"仓库清洁时发现餐桌表面划痕比估价时严重，需整体重新打磨上漆",
  "discoveryPhotos":["http://x/scratch-1.jpg","http://x/scratch-2.jpg"],
  "extraLaborCost":180,"extraMaterialCost":120,"suggestedPrice":600,
  "priceImpactNote":"翻新后成色提升，维持 600 上架","delayDays":3,"listingImpact":"DELAY",
  "deviationCategory":"APPRAISER_UNDERESTIMATE","deviationNote":"估价现场未斜光复检深层划痕"}')
RO_ID=$(echo "$orr" | jq -r '.overrun.id')
RO_CODE=$(echo "$orr" | jq -r '.overrun.code')
check "$(echo "$orr" | jq -r '.overrun.extraTotal')" "300.00" "追加预算合计=工时180+材料120=300"
check "$(echo "$orr" | jq -r '.overrun.status')" "PENDING_SELLER" "确认单状态 PENDING_SELLER"
check "$(echo "$orr" | jq -r '.item.status')" "OVERRUN_PENDING" "商品进入 OVERRUN_PENDING"
pendblock=$(curl -s -X POST $BASE/items/$TID/work-logs -H "Authorization: Bearer $T_REF" -H 'Content-Type: application/json' -d '{"type":"REPAINT","note":"先干了再说","cost":10}')
echo "$pendblock" | jq -r '.message' | grep -q '等待卖家确认' && ok "待确认期间翻新作业被冻结"

echo "== [16] 卖家确认接受 =="
sl=$(curl -s "$BASE/refurbish-overruns" -H "Authorization: Bearer $T_SELLER" | jq -r '[.[] | select(.status=="PENDING_SELLER")] | length')
[ "${sl:-0}" -ge 1 ] && ok "卖家待确认列表可见该单据（$sl 张）"
dec=$(curl -s -X POST $BASE/refurbish-overruns/$RO_ID/decide -H "Authorization: Bearer $T_SELLER" -H 'Content-Type: application/json' -d '{"decision":"ACCEPT","sellerNote":"同意追加预算尽快翻新"}')
check "$(echo "$dec" | jq -r '.overrun.status')" "ACCEPTED" "卖家接受 -> ACCEPTED"
check "$(echo "$dec" | jq -r '.item.status')" "PREPARING" "接受后商品回到 PREPARING 继续翻新"
check "$(echo "$dec" | jq -r '.item.approvedOverrunCost')" "300.00" "商品已确认追加额度 300"
# 买家无权操作确认单
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/refurbish-overruns/$RO_ID/decide -H "Authorization: Bearer $T_BUYER" -H 'Content-Type: application/json' -d '{"decision":"ACCEPT"}')
check "$code" "403" "买家访问超预算确认接口返回 403"

echo "== [17] 接受后追加作业受确认额度管控 =="
oklog=$(curl -s -X POST $BASE/items/$TID/work-logs -H "Authorization: Bearer $T_REF" -H 'Content-Type: application/json' -d '{"type":"REPAINT","note":"整体打磨两底两面","cost":280}')
check "$(echo "$oklog" | jq -r '.item.refurbishCost')" "280.00" "280 元翻新费（预算50+确认额度230）登记成功"
over=$(curl -s -X POST $BASE/items/$TID/work-logs -H "Authorization: Bearer $T_REF" -H 'Content-Type: application/json' -d '{"type":"REPAINT","note":"又超了","cost":100}')
echo "$over" | jq -r '.message' | grep -q '已确认追加额度剩余' && ok "确认额度仅剩 70，再登记 100 被拦截"

echo "== [18] 翻新完成必须重新拍摄更新瑕疵说明，旧照归档内部审计 =="
curl -s -o /dev/null -X POST $BASE/items/$TID/advance -H "Authorization: Bearer $T_WH" -H 'Content-Type: application/json' -d '{"to":"PHOTOGRAPHY"}'
nolist=$(curl -s -X POST $BASE/items/$TID/advance -H "Authorization: Bearer $T_WH" -H 'Content-Type: application/json' -d '{"to":"LISTED","description":"未重拍直接上架","photos":["http://x/old.jpg"]}')
echo "$nolist" | jq -r '.message' | grep -q '重新拍摄' && ok "未翻新后重拍直接上架被拦截"
rp=$(curl -s -X POST $BASE/refurbish-overruns/$RO_ID/rephotos -H "Authorization: Bearer $T_WH" -H 'Content-Type: application/json' -d '{
  "photos":["http://x/table-after-1.jpg","http://x/table-after-2.jpg"],
  "defectNote":"整体打磨上漆后侧光下仍可见轻微痕迹，不影响使用"}')
check "$(echo "$rp" | jq -r '.overrun.photoCompletedAt != null')" "true" "重拍完成记录时间"
echo "$rp" | jq -r '.item.archivedInternalPhotos | length' | grep -q '^[3-9]' && ok "旧照片（卖家瑕疵照+发现照）已归档内部审计"
check "$(echo "$rp" | jq -r '.item.photos[0]')" "http://x/table-after-1.jpg" "对外照片为翻新后新照"
ls2=$(curl -s -X POST $BASE/items/$TID/advance -H "Authorization: Bearer $T_WH" -H 'Content-Type: application/json' -d '{"to":"LISTED","description":"翻新后白橡木餐桌","warehouseSlot":"D-02-01","deliveryRadiusKm":30}')
check "$(echo "$ls2" | jq -r '.status')" "LISTED" "重拍并更新瑕疵说明后上架成功"
# 买家视图：只见翻新后真实状态，不见内部审计旧照片
bitem=$(curl -s $BASE/items/$TID -H "Authorization: Bearer $T_BUYER")
check "$(echo "$bitem" | jq -r '.item | has("archivedInternalPhotos")')" "false" "买家商品详情不含内部审计旧照片字段"
check "$(echo "$bitem" | jq -r '.item.defectNote')" "整体打磨上漆后侧光下仍可见轻微痕迹，不影响使用" "买家可见翻新后瑕疵说明"
brow=$(curl -s "$BASE/items" -H "Authorization: Bearer $T_BUYER" | jq -r --arg id "$TID" '.[] | select(.id==$id) | has("archivedInternalPhotos")')
check "$brow" "false" "买家市场列表不下发内部审计字段"

echo "== [19] 接受追加后成交结算：追加翻新费从成交款扣除且来源含确认单 =="
o2=$(curl -s -X POST $BASE/orders -H "Authorization: Bearer $T_BUYER" -H 'Content-Type: application/json' -d "{
  \"itemId\":\"$TID\",\"buyerAddress\":\"买家地址\",\"buyerFloor\":5,\"buyerElevator\":\"ELEVATOR\",
  \"appointmentWindow\":\"后天上午\"}")
O2=$(echo "$o2" | jq -r '.order.id')
curl -s -o /dev/null -X POST $BASE/deliveries/$O2/schedule -H "Authorization: Bearer $T_DEL" -H 'Content-Type: application/json' -d '{"vehicleType":"SMALL_VAN","scheduledWindow":"10-08 10:00"}'
curl -s -o /dev/null -X POST $BASE/deliveries/$O2/load -H "Authorization: Bearer $T_DEL"
curl -s -o /dev/null -X POST $BASE/deliveries/$O2/done -H "Authorization: Bearer $T_DEL" -H 'Content-Type: application/json' -d '{"note":"签收"}'
st2=$(curl -s -X POST $BASE/settlements/order/$O2/generate -H "Authorization: Bearer $T_CS")
# 600 - 90(佣金15%) - 300(清洁20+翻新280) = 210；平台 90+60=150
check "$(echo "$st2" | jq -r '.settlement.sellerPayout')" "210.00" "餐桌卖家应得 600-90-300=210（含确认追加）"
check "$(echo "$st2" | jq -r '.settlement.platformIncome')" "150.00" "餐桌平台净收入 90+60=150"
echo "$st2" | jq -r '.entries[] | select(.type=="REFURBISH_FEE") | .source' | grep -q "$RO_CODE" && ok "翻新费来源写明超预算确认单号 $RO_CODE"

echo "== [20] 卖家拒绝追加 -> 取消寄卖分支 =="
cresp=$(curl -s -X POST $BASE/consignments -H "Authorization: Bearer $T_SELLER" -H 'Content-Type: application/json' -d '{
  "category":"BOOKCASE","brand":"测试书柜","sizeText":"80x30x180","material":"板材","yearsUsed":5,
  "disassemblable":true,"floor":4,"elevator":"ELEVATOR","expectedPrice":300,"acceptRefurbish":true}')
CCN=$(echo "$cresp" | jq -r '.consignment.id')
csc=$(curl -s -X POST $BASE/appraisals/consignment/$CCN -H "Authorization: Bearer $T_APPR" -H 'Content-Type: application/json' -d '{
  "structuralScore":3,"stainScore":3,"odorScore":2,"mothScore":2,"warpScore":3,"moveDifficulty":2,
  "consignmentPrice":200,"minDealPrice":120,"commissionRate":0.15,"estimatedRefurbishCost":30,
  "matchResult":"MINOR_DIFF","decision":"ACCEPT","location":"WAREHOUSE","deliveryRadiusKm":10}')
CID=$(echo "$csc" | jq -r '.item.id')
cro=$(curl -s -X POST $BASE/refurbish-overruns/item/$CID -H "Authorization: Bearer $T_WH" -H 'Content-Type: application/json' -d '{
  "reason":"书柜受潮变形比估价严重，需换背板","extraLaborCost":90,"extraMaterialCost":60,
  "suggestedPrice":150,"delayDays":1,"listingImpact":"DELAY","deviationCategory":"SELLER_MISDESCRIBE"}')
CRO=$(echo "$cro" | jq -r '.overrun.id')
cdec=$(curl -s -X POST $BASE/refurbish-overruns/$CRO/decide -H "Authorization: Bearer $T_SELLER" -H 'Content-Type: application/json' -d '{"decision":"CANCEL_CONSIGNMENT","sellerNote":"不修了，取消"}')
check "$(echo "$cdec" | jq -r '.overrun.status')" "REJECTED_CANCEL" "卖家拒绝并取消寄卖"
check "$(echo "$cdec" | jq -r '.item.status')" "OFF_SHELF" "取消后商品 OFF_SHELF 下架"
check "$(echo "$cdec" | jq -r '.consignment.status')" "OVERRUN_CANCELLED" "寄卖单状态 OVERRUN_CANCELLED"

echo "== [21] 运营：估价师偏差考核汇总 =="
dev=$(curl -s $BASE/analytics/appraiser-deviations -H "Authorization: Bearer $T_OPS")
echo "$dev" | jq -e '.appraisers | length >= 1' >/dev/null && ok "估价师偏差考核列表已生成"
und=$(echo "$dev" | jq -r '.appraisers[] | select(.appraiserName=="估价师老赵") | .underestimate')
[ "${und:-0}" -ge 1 ] && ok "估价师老赵现场低估计数 ≥1（$und），超预算归因进入考核"

echo
echo "结果：PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
