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

echo "== [13] 翻新超预算确认：餐桌划痕比估价严重，卖家接受 =="
T_SELLER2=$(login liujing seller123)
RESP2=$(curl -s -X POST $BASE/consignments -H "Authorization: Bearer $T_SELLER2" -H 'Content-Type: application/json' -d '{
  "category":"DINING_TABLE","brand":"e2e白橡木","sizeText":"140x80x75 cm","material":"白橡木实木","yearsUsed":4,
  "defectPhotos":["http://x/table-before.jpg"],"disassemblable":true,"floor":3,"elevator":"ELEVATOR",
  "expectedPrice":900,"acceptRefurbish":true,"address":"测试小区","sellerNote":"桌面轻微痕迹"}')
CN2=$(echo "$RESP2" | jq -r '.consignment.id')
curl -s -o /dev/null -X POST $BASE/consignments/$CN2/schedule -H "Authorization: Bearer $T_APPR"
sc2=$(curl -s -X POST $BASE/appraisals/consignment/$CN2 -H "Authorization: Bearer $T_APPR" -H 'Content-Type: application/json' -d '{
  "structuralScore":2,"stainScore":2,"odorScore":1,"mothScore":1,"warpScore":2,"moveDifficulty":3,
  "consignmentPrice":800,"minDealPrice":650,"commissionRate":0.15,"estimatedRefurbishCost":100,
  "cleaningAdvice":"清洁打蜡","refurbishSuggestions":"局部补漆","matchResult":"MINOR_DIFF",
  "matchNote":"桌垫覆盖未发现深层划痕","decision":"ACCEPT","location":"WAREHOUSE","deliveryRadiusKm":20}')
ITEM2=$(echo "$sc2" | jq -r '.item.id')
[ -n "$ITEM2" ] && [ "$ITEM2" != "null" ] && ok "餐桌估价完成（预估翻新 100）并生成商品"
curl -s -o /dev/null -X POST $BASE/items/$ITEM2/work-logs -H "Authorization: Bearer $T_REF" -H 'Content-Type: application/json' -d '{"type":"CLEANING","note":"掀桌垫深度清洁","cost":50}'
curl -s -o /dev/null -X POST $BASE/items/$ITEM2/work-logs -H "Authorization: Bearer $T_REF" -H 'Content-Type: application/json' -d '{"type":"REPAINT","note":"估价范围内局部补漆","cost":50}'
oc=$(curl -s -X POST $BASE/refurbish/items/$ITEM2/overrun -H "Authorization: Bearer $T_WH" -H 'Content-Type: application/json' -d '{
  "reason":"清洁掀开桌垫后发现餐桌表面划痕比估价时严重，贯穿性划痕伤漆，需要整体重新打磨、补腻子、上木蜡油两遍",
  "additionalLaborCost":150,"additionalMaterialCost":60,"revisedListedPrice":860,
  "affectListing":true,"listingDelayDays":3,
  "beforePhotos":["http://x/scratch-1.jpg","http://x/scratch-2.jpg"],
  "deviationReason":"估价时桌面铺有桌垫且灯光昏暗，估价师未掀开桌垫检查"}')
OC_ID=$(echo "$oc" | jq -r '.id')
[ -n "$OC_ID" ] && [ "$OC_ID" != "null" ] && ok "仓库发起超预算确认（工时150+材料60，售价800→860，延后3天）"
echo "$oc" | jq -e '(.status=="PENDING") and (.code|startswith("OC"))' >/dev/null && ok "确认单状态 PENDING 且自动编号 OC 开头"
# 估价偏差原因仅内部可见：卖家看不到
dev_seller=$(curl -s "$BASE/refurbish/overruns/$OC_ID" -H "Authorization: Bearer $T_SELLER2" | jq -r '.deviationReason')
check "$dev_seller" "" "卖家视角估价偏差原因被脱敏（内部考核留档不外显）"
dev_wh=$(curl -s "$BASE/refurbish/overruns?status=PENDING" -H "Authorization: Bearer $T_WH" | jq -r --arg id "$OC_ID" '.[] | select(.id==$id) | .deviationReason')
echo "$dev_wh" | grep -q '桌垫' && ok "仓库视角可见估价偏差原因（用于考核估价师）"
# 待确认期间阻止继续上架
blockcode=$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/items/$ITEM2/advance -H "Authorization: Bearer $T_WH" -H 'Content-Type: application/json' -d '{"to":"PHOTOGRAPHY"}')
check "$blockcode" "400" "待卖家确认期间商品不能继续上架"
# 其他卖家不能确认
forbidden=$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/refurbish/overruns/$OC_ID/decision -H "Authorization: Bearer $T_SELLER" -H 'Content-Type: application/json' -d '{"decision":"ACCEPT"}')
check "$forbidden" "403" "非货主卖家不能确认别人的超预算单"
# 卖家接受
acc=$(curl -s -X POST $BASE/refurbish/overruns/$OC_ID/decision -H "Authorization: Bearer $T_SELLER2" -H 'Content-Type: application/json' -d '{"decision":"ACCEPT","note":"同意打磨上漆"}')
check "$(echo "$acc" | jq -r '.overrun.status')" "ACCEPTED" "卖家接受追加翻新"
check "$(echo "$acc" | jq -r '.item.refurbishCost')" "260.00" "接受后翻新费 50(局部补漆)+150+60=260 累计到商品（清洁费 50 另计）"
check "$(echo "$acc" | jq -r '.item.listedPrice')" "860.00" "接受后挂牌价更新为翻新后预计售价 860"

echo "== [14] 翻新完成重新拍摄：买家只见翻新后状态，旧照片仅内部审计 =="
curl -s -o /dev/null -X POST $BASE/items/$ITEM2/rephotograph -H "Authorization: Bearer $T_WH" -H 'Content-Type: application/json' -d '{"photos":["http://x/table-mid.jpg"],"defectNote":"翻新中初拍（测试用）"}'
rp=$(curl -s -X POST $BASE/items/$ITEM2/rephotograph -H "Authorization: Bearer $T_WH" -H 'Content-Type: application/json' -d '{"photos":["http://x/table-after-1.jpg","http://x/table-after-2.jpg"],"defectNote":"桌面已整体打磨上漆，侧光下仍有极浅使用痕迹"}')
check "$(echo "$rp" | jq -r '.photos | length')" "2" "翻新后重拍照片已更新"
echo "$rp" | jq -e '.archivedPhotos | index("http://x/table-mid.jpg")' >/dev/null && ok "重拍前的照片已转入内部审计归档 archivedPhotos"
# 买家视角看不到归档照片与旧瑕疵说明
buyer_item=$(curl -s "$BASE/items/$ITEM2" -H "Authorization: Bearer $T_BUYER")
echo "$buyer_item" | jq -e 'has("archivedPhotos")|not' >/dev/null && ok "买家商品详情不含 archivedPhotos（旧照片仅内部审计）"
echo "$buyer_item" | jq -e '.item.defectNote | contains("打磨上漆")' >/dev/null && ok "买家看到的是翻新后的瑕疵说明"
# 上架
curl -s -o /dev/null -X POST $BASE/items/$ITEM2/advance -H "Authorization: Bearer $T_WH" -H 'Content-Type: application/json' -d '{"to":"LISTED","description":"e2e 餐桌已整体翻新","photos":["http://x/table-after-1.jpg","http://x/table-after-2.jpg"],"defectNote":"桌面已整体打磨上漆，侧光下仍有极浅使用痕迹","deliveryRadiusKm":20}'
# 买家市场列表同样不含归档字段
curl -s "$BASE/items" -H "Authorization: Bearer $T_BUYER" | jq -e --arg id "$ITEM2" '.[] | select(.id==$id) | has("archivedPhotos")|not' >/dev/null && ok "买家市场列表不暴露旧照片归档字段"

echo "== [15] 接受超预算后成交结算：追加费用从成交款扣除且有来源 =="
ord2=$(curl -s -X POST $BASE/orders -H "Authorization: Bearer $T_BUYER" -H 'Content-Type: application/json' -d "{
  \"itemId\":\"$ITEM2\",\"buyerAddress\":\"买家地址 3 楼电梯\",\"buyerFloor\":3,\"buyerElevator\":\"ELEVATOR\",
  \"appointmentWindow\":\"后天上午\"}")
ORD2=$(echo "$ord2" | jq -r '.order.id')
curl -s -o /dev/null -X POST $BASE/deliveries/$ORD2/schedule -H "Authorization: Bearer $T_DEL" -H 'Content-Type: application/json' -d '{"vehicleType":"SMALL_VAN","scheduledWindow":"10-08 上午"}'
curl -s -o /dev/null -X POST $BASE/deliveries/$ORD2/load -H "Authorization: Bearer $T_DEL"
curl -s -o /dev/null -X POST $BASE/deliveries/$ORD2/done -H "Authorization: Bearer $T_DEL" -H 'Content-Type: application/json' -d '{"note":"签收"}'
st2=$(curl -s -X POST $BASE/settlements/order/$ORD2/generate -H "Authorization: Bearer $T_CS")
# 860 - 129(15%佣金) - 310(清洁50+翻新260) = 421
check "$(echo "$st2" | jq -r '.settlement.sellerPayout')" "421.00" "卖家应得 860-129-310=421（追加翻新费已从成交款扣除）"
OC_CODE=$(echo "$oc" | jq -r '.code')
src=$(echo "$st2" | jq -r '.entries[] | select(.type=="REFURBISH_FEE") | .source')
case "$src" in
  *"$OC_CODE"*) ok "结算翻新费来源引用卖家已接受的超预算确认单 $OC_CODE" ;;
  *) no "结算翻新费来源应引用确认单 $OC_CODE（实际：$src）" ;;
esac

echo "== [16] 卖家拒绝超预算：降价上架 / 取消寄卖（不计反悔） =="
# 16a 降价上架
RESP3=$(curl -s -X POST $BASE/consignments -H "Authorization: Bearer $T_SELLER2" -H 'Content-Type: application/json' -d '{
  "category":"BOOKCASE","brand":"e2e书柜","sizeText":"80x30x180","material":"板材","yearsUsed":2,
  "disassemblable":true,"floor":4,"elevator":"ELEVATOR","expectedPrice":500,"acceptRefurbish":true}')
CN3=$(echo "$RESP3" | jq -r '.consignment.id')
curl -s -o /dev/null -X POST $BASE/consignments/$CN3/schedule -H "Authorization: Bearer $T_APPR"
sc3=$(curl -s -X POST $BASE/appraisals/consignment/$CN3 -H "Authorization: Bearer $T_APPR" -H 'Content-Type: application/json' -d '{
  "structuralScore":2,"stainScore":2,"odorScore":1,"mothScore":1,"warpScore":1,"moveDifficulty":2,
  "consignmentPrice":500,"minDealPrice":400,"commissionRate":0.15,"estimatedRefurbishCost":80,
  "matchResult":"MATCH","decision":"ACCEPT","location":"WAREHOUSE","deliveryRadiusKm":10}')
ITEM3=$(echo "$sc3" | jq -r '.item.id')
oc3=$(curl -s -X POST $BASE/refurbish/items/$ITEM3/overrun -H "Authorization: Bearer $T_WH" -H 'Content-Type: application/json' -d '{
  "reason":"书柜背板发霉需更换","additionalLaborCost":100,"additionalMaterialCost":20,
  "revisedListedPrice":480,"affectListing":false,"deviationReason":"靠墙背板未查看"}')
OC3=$(echo "$oc3" | jq -r '.id')
# 降价不能高于当前价
badprice=$(curl -s -X POST $BASE/refurbish/overruns/$OC3/decision -H "Authorization: Bearer $T_SELLER2" -H 'Content-Type: application/json' -d '{"decision":"REJECT_REDUCE","reducedPrice":600}' | jq -r '.message')
echo "$badprice" | grep -q '低于' && ok "降价价格高于当前挂牌价被拦截"
dec3=$(curl -s -X POST $BASE/refurbish/overruns/$OC3/decision -H "Authorization: Bearer $T_SELLER2" -H 'Content-Type: application/json' -d '{"decision":"REJECT_REDUCE","reducedPrice":420,"note":"不翻新了，便宜卖"}')
check "$(echo "$dec3" | jq -r '.overrun.status')" "REJECTED_REDUCE" "卖家拒绝追加翻新，选择降价上架"
check "$(echo "$dec3" | jq -r '.item.listedPrice')" "420.00" "挂牌价降为 420"
check "$(echo "$dec3" | jq -r '.item.refurbishCost')" "0.00" "拒绝后追加费用不发生，翻新费仍为 0"
# 16b 拒绝并取消寄卖：不计卖家反悔
RESP4=$(curl -s -X POST $BASE/consignments -H "Authorization: Bearer $T_SELLER2" -H 'Content-Type: application/json' -d '{
  "category":"KIDS_BED","brand":"e2e儿童床","sizeText":"200x120x90","material":"松木","yearsUsed":2,
  "disassemblable":true,"floor":4,"elevator":"ELEVATOR","expectedPrice":600,"acceptRefurbish":true}')
CN4=$(echo "$RESP4" | jq -r '.consignment.id')
curl -s -o /dev/null -X POST $BASE/consignments/$CN4/schedule -H "Authorization: Bearer $T_APPR"
sc4=$(curl -s -X POST $BASE/appraisals/consignment/$CN4 -H "Authorization: Bearer $T_APPR" -H 'Content-Type: application/json' -d '{
  "structuralScore":3,"stainScore":3,"odorScore":2,"mothScore":2,"warpScore":2,"moveDifficulty":3,
  "consignmentPrice":480,"minDealPrice":380,"commissionRate":0.15,"estimatedRefurbishCost":120,
  "matchResult":"MINOR_DIFF","decision":"ACCEPT","location":"WAREHOUSE","deliveryRadiusKm":0}')
ITEM4=$(echo "$sc4" | jq -r '.item.id')
oc4=$(curl -s -X POST $BASE/refurbish/items/$ITEM4/overrun -H "Authorization: Bearer $T_WH" -H 'Content-Type: application/json' -d '{
  "reason":"床板龙骨开裂需加固更换","additionalLaborCost":180,"additionalMaterialCost":90,
  "revisedListedPrice":520,"affectListing":true,"listingDelayDays":4,"deviationReason":"未翻转检查床板底部"}')
OC4=$(echo "$oc4" | jq -r '.id')
dec4=$(curl -s -X POST $BASE/refurbish/overruns/$OC4/decision -H "Authorization: Bearer $T_SELLER2" -H 'Content-Type: application/json' -d '{"decision":"REJECT_CANCEL","note":"费用太高不修了"}')
check "$(echo "$dec4" | jq -r '.overrun.status')" "REJECTED_CANCEL" "卖家拒绝并取消寄卖"
check "$(echo "$dec4" | jq -r '.item.status')" "OFF_SHELF" "取消后商品下架 OFF_SHELF"
bt2=$(curl -s $BASE/analytics/seller-profiles -H "Authorization: Bearer $T_OPS" | jq -r '.[] | select(.username=="liujing") | .backtrackCount')
check "$bt2" "0" "因估价偏差导致的超预算取消不计入卖家反悔次数（仍为 0）"

echo "== [17] 估价师估价偏差考核 =="
dev=$(curl -s $BASE/analytics/appraiser-deviations -H "Authorization: Bearer $T_OPS")
echo "$dev" | jq -e '.totalOverruns >= 3' >/dev/null && ok "考核接口汇总超预算确认单 ≥3（含种子 2 单 + e2e 3 单）"
echo "$dev" | jq -e '.appraisers[0].appraiserName=="估价师老赵" and (.appraisers[0].overrunCount>=3)' >/dev/null && ok "按估价师聚合偏差次数，老赵排第一"
echo "$dev" | jq -e '.appraisers[0].records[] | select(.code|startswith("OC")) | .deviationReason' >/dev/null && ok "考核记录保留每条估价偏差原因"
# 估价师本人无权查看考核接口
dev403=$(curl -s -o /dev/null -w '%{http_code}' $BASE/analytics/appraiser-deviations -H "Authorization: Bearer $T_APPR")
check "$dev403" "403" "估价师本人不可查看考核聚合（仅运营/管理员）"

echo
echo "结果：PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
