# 邻栖 · 城市二手家具寄卖估价上架配送与售后平台

围绕**一件家具**打通完整链路：居民寄卖申请 → 估价师上门验真报价 → 清洁/补漆/入仓/拍照/上架 →
买家下单 → 配送排班（楼层/电梯/拆装/车辆/旧家具搬出）→ 异常协同工单（卖家反悔、估价与实物不符、
翻新超支、色差、沙发进不了电梯、途中磕碰、退货）→ 逐项有来源的结算 → 品类运营分析与卖家风险画像。

技术栈：**React 18 + Vite + TypeScript**（前端）· **NestJS 10 + TypeORM**（后端）· **PostgreSQL 15**。

---

## 一、一键启动（Docker Compose，推荐）

需要 Docker 20.10+ 与 Docker Compose v2。

```bash
docker compose up --build
```

启动后：

| 服务 | 地址 | 说明 |
| --- | --- | --- |
| 前端（Nginx 托管） | http://localhost:8080 | 全部业务页面 |
| 后端 API | http://localhost:3000/api | NestJS，仅后端调试时直接访问 |
| PostgreSQL | localhost:5432 | 库名/用户/密码：furniture / postgres / postgres |

首次启动后端会**自动建表并写入演示数据**（约 5~10 秒，等待 API 日志出现
`Furniture consignment API listening`）。清空数据重来：

```bash
docker compose down -v   # -v 删除数据卷
docker compose up --build
```

> 本项目为全栈应用（含完整前端业务页面），按任务约定不单独提供 Swagger UI；
> 后端 REST 接口可通过前端各角色页面操作验证，接口清单见文末附录。

## 二、本地开发启动（不用 Docker）

前置：Node.js 20+、一个可连接的 PostgreSQL 15。

### 1. 准备数据库

```bash
createdb -U postgres furniture
# 或：psql -U postgres -c "CREATE DATABASE furniture;"
```

### 2. 后端（端口 3000）

```bash
cd backend
npm install
# 按实际情况修改 backend/.env（DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME）
npm run dev          # 开发模式（ts-node）
# 或
npm run build && npm start
```

后端启动时自动建表（TypeORM synchronize）并在空库上写入演示种子数据。
若不需要种子，设置环境变量 `SEED_ON_BOOT=false`。

### 3. 前端（端口 5173）

```bash
cd frontend
npm install
npm run dev
```

Vite 已配置 `/api` 代理到 `http://127.0.0.1:3000`（可用环境变量 `VITE_API_TARGET` 覆盖）。
打开 http://localhost:5173 即可。

前端生产构建：`npm run build`（产物在 `frontend/dist`，容器中由 Nginx 托管）。

---

## 三、测试账号

| 角色 | 账号 | 密码 | 能做什么 |
| --- | --- | --- | --- |
| 卖家（信用良好） | `wangjiayi` | `seller123` | 提交寄卖、查看验真等级/估价、反悔、看自己的结算 |
| 卖家（高风险） | `linfan` | `seller123` | 有 1 次反悔 + 1 次描述不符，新寄卖自动触发**严格验真** |
| 卖家 | `liujing` | `seller123` | 有一单已成交结算的办公椅 |
| 买家 | `zhangmai` | `buyer123` | 逛市场、下单（含电梯/楼层/旧家具搬出计价）、发起售后 |
| 买家 | `sunmai` | `buyer123` | 有一单"沙发进不了电梯"退货工单 |
| 估价师 | `gujia` | `gujia123` | 上门预约、六项验真打分、寄卖价/底价/佣金、相符度、入仓/自提 |
| 仓库管理 | `cangguan` | `cangguan123` | 入库库位、拍照、上架描述、退货返仓重新上架 |
| 翻新师 | `fanxin` | `fanxin123` | 清洁/补漆/维修作业登记（费用入结算） |
| 配送 | `peisong` | `peisong123` | 排班、车辆、装车、送达、失败原因登记 |
| 客服 | `kefu` | `kefu123` | 协同工单六方留言、客服裁定、生成结算单 |
| 运营 | `ops` | `ops123` | 品类分析看板、卖家风险画像、结算查看 |
| 管理员 | `admin` | `admin123` | 与运营/客服同等权限 |

登录页也提供"一键填充"按钮。买家/卖家还可在登录页自助注册（接口
`POST /api/auth/register`，仅开放 SELLER/BUYER 两种身份）。

## 四、推荐验证路径（业务主线）

1. **卖家 `wangjiayi` 登录**：顶部显示信用画像（风险分 0、常规验真）；可提交一件沙发寄卖。
2. 切换 **估价师 `gujia`**：待办队列里高风险卖家 `linfan` 的申请带"⚠ 严格验真"并置顶；
   对新申请逐项打分（结构/污渍/异味/虫蛀/变形/搬运难度），填写寄卖价、底价、佣金率、
   清洁翻新建议，选择"相符/轻微不符/严重不符"，决定入仓或留卖家家中、配送半径。
3. **翻新师 `fanxin` / 仓库 `cangguan`**：登记清洁、补漆费用 → 清洁完成 → 拍照 →
   填写上架描述/库位/配送范围 → 上架。
   - 种子中王阿姨的白橡木餐桌（`CN202600008`）清洁时发现**划痕比估价时严重**，
     仓库已发起「翻新成本超预算确认」，等待卖家处理。
4. **切换卖家 `wangjiayi`** → 顶部「翻新预算确认」页签：看到餐桌需要重新打磨上漆，
   平台把**新增工时费、材料费、预计售价变化（780→860）、上架延后 3 天、翻新前照片**推来确认；
   - **接受**：追加工时+材料计入翻新费，成交后从成交款扣除；翻新完成后仓库重新拍摄、
     更新瑕疵说明，旧照片只留在内部审计，买家只见翻新后真实状态。
   - **拒绝 → 降价上架**：不追加翻新，按现状降价直接上架。
   - **拒绝 → 取消寄卖**：商品下架、寄卖终止，因属平台估价偏差，**不计入卖家反悔画像**。
   - 卖家视角看不到「估价偏差原因」；该原因只在仓库/运营侧保留用于考核估价师。
5. **买家 `zhangmai`**：市场下单，选择无电梯楼层、旧家具搬出，实时看到配送费计价；
   订单锁定商品。
6. **配送 `peisong`**：按楼层/拆装/车辆/旧家具搬出/预约时间排班 → 装车 → 送达；
   也可对种子中的大沙发尝试"配送失败 → 进不了电梯"。
7. **买家**在订单页发起"色差/磕碰/退货"工单；**仓库、配送、客服**依次进入同一工单留言协同；
   **客服 `kefu`** 裁定处理结论（维持/降价/卖家或平台赔付/退货退款/重新上架/终止寄卖），
   订单、商品、寄卖单状态随之联动。
8. **客服**在"结算管理"对已送达订单生成结算单：成交价、佣金、翻新费（含卖家已接受的
   超预算追加，附确认单号）、仓储费（按在仓天数）、配送费、售后赔付、卖家应得逐项列出**来源说明**；
   退货单展示平台吸收的成本。
9. **运营 `ops`**：查看六品类成交周期、翻新投入占比、退货原因、配送失败率与
   "适合入仓寄卖 / 建议同城自提"渠道建议；查看卖家风险画像排序；页面底部另有
   **「估价师估价偏差考核」**：按估价师聚合超预算次数、追加成本与接受/降价/取消分布，
   并保留每条估价偏差原因。
10. 用 **`linfan`** 再提交一件寄卖，确认申请自动带上"严格验真"；卖家在约估价后反悔，
    画像中反悔次数与风险分立即变化。
11. 种子中刘静的全友餐桌（`CN202600009` / 确认单 `OC202600002`）是**卖家已接受**的完整样例：
    翻新费含 190 元追加、已翻新后重拍上架，旧照片在仓库详情的"内部审计"区可见。

## 五、自动化验证

后端附端到端接口脚本（需要先启动后端与空库/种子库）：

```bash
cd backend
bash e2e-test.sh
```

覆盖：鉴权与角色拦截 → 申请（画像联动）→ 六项验真估价（含底价校验）→ 作业记账 →
上架 → 下单与配送费计价 → 排班/装车/送达 → 工单协同与客服裁定 → 结算金额与来源 →
品类分析与渠道建议 → 严格验真触发 → 反悔计入画像 →
**翻新超预算确认全链路（发起/偏差原因脱敏/待确认拦截/接受扣款/拒绝降价/拒绝取消不计反悔）→
翻新后重拍与旧照片内部审计隔离 → 超预算费用结算来源 → 估价师偏差考核**，共 48 项断言。

## 六、实际执行过的验证（本工作区）

- `cd backend && npx tsc` 编译通过；`cd frontend && npm run build`（tsc 类型检查 + vite 打包）通过。
- 本地 PostgreSQL 15 临时实例（trust 认证、端口 5433、空库）上启动后端，种子数据成功写入
  （含 2 张超预算确认单：1 张待卖家确认、1 张卖家已接受并重拍上架）。
- `bash backend/e2e-test.sh` 结果：**PASS=48 FAIL=0**。
- 额外手工验证：卖家「拒绝并降价上架」后商品可正常推进到在售且挂牌价为降价后价格；
  「拒绝并取消寄卖」商品保持 OFF_SHELF；非货主卖家确认他人超预算单返回 403。
- Vite dev server 返回 200，经其 `/api` 代理登录接口返回有效 JWT。
- Docker 守护进程在当前沙箱不可用，镜像未在本机实际构建；`docker-compose.yml`
  与两个 Dockerfile 已按标准 node:22-alpine / nginx:1.27-alpine 多阶段构建编写，
  请在有 Docker 的环境执行 `docker compose up --build` 验证。

## 七、核心业务规则

- **验真等级**：风险分 = 反悔×3 + 描述不符×2 + 售后争议×1 − 成交×0.5；≥4 分或描述不符 ≥2 次
  → 新寄卖自动 STRICT（估价师工作台置顶，逐项核对）。
- **价格**：最低成交价（底价）不可高于寄卖价；买家出价低于底价无法下单。
- **配送费**：基础 ¥60；无电梯/楼梯房 `（楼层−1)×¥15`；旧家具搬出 +¥80；配送半径 0km（同城自提）免配送费。
- **仓储费**：在仓商品按 ¥3/天，从入库时间计至结算日；留卖家家中不收仓储费。
- **翻新成本超预算确认**：
  - 清洁发现瑕疵比估价时严重时，仓库/翻新师发起确认，填写新增**工时费、材料费、翻新后预计售价、
    是否影响上架（延后天数）、翻新前照片**，以及仅内部可见的**估价偏差原因**，系统自动生成
    REFURBISH_OVERRUN 协同工单并生成 OC 编号确认单。
  - 确认单 PENDING 期间商品不能继续上架；仅货主卖家可做决定，其他角色（含其他卖家）无权操作。
  - **卖家接受**：追加工时+材料累加进商品翻新费（同时写一条作业记录），挂牌价更新为翻新后预计售价，
    成交结算时从成交款扣除，结算明细引用确认单号。
  - **卖家拒绝·降价上架**：追加费用不发生，按卖家给出的、低于当前价的新价直接上架。
  - **卖家拒绝·取消寄卖**：商品下架、寄卖单标记 `cancelReason=OVERRUN_REJECTED`；
    因属平台估价偏差，**不计入卖家反悔次数与风险画像**。
  - **估价偏差原因**仅平台内部角色可见（仓库/翻新/客服/运营/管理员/估价师/配送），卖家接口自动脱敏；
    运营可在 `GET /analytics/appraiser-deviations` 按估价师查看偏差次数、追加成本与每条原因。
- **翻新后重拍**：翻新完成后仓库必须重新拍摄并更新瑕疵说明；新照片/新瑕疵说明对买家展示，
  旧照片与旧说明移入 `archivedPhotos`/`archivedDefectNote`，买家与卖家接口不返回这两个字段，
  仅在内部审计（仓库等内部角色详情）可见。
- **结算**：
  - 正常成交：卖家应得 = 成交价 − 佣金（估价单费率）− 清洁翻新费（作业记录，含卖家已接受的超预算追加）− 仓储费 − 卖家责任赔付；
    平台净收入 = 佣金 + 配送费 − 平台责任赔付。
  - 退货：买家全额退款，卖家应得为 0，已发生的翻新/仓储/配送成本由平台吸收（工单另有约定从其约定）。
- **渠道建议**：品类配送失败率 ≥25% 或电梯/楼道受阻占失败多数 → 建议同城自提为主；
  成交周期 ≤7 天、翻新占均价比 ≤12%、退货率 ≤15% → 适合入仓寄卖。

## 八、接口清单（附录）

所有接口前缀 `/api`，除 `auth/login`、`auth/register` 外均需 `Authorization: Bearer <token>`，
并按角色授权。

- `POST /auth/login`、`POST /auth/register`、`GET /auth/me`
- `POST /consignments`（卖家提交）、`GET /consignments`、`GET /consignments/:id`、
  `POST /consignments/:id/schedule`（估价师预约）、`POST /consignments/:id/cancel`（卖家反悔）
- `GET /appraisals/queue/pending`、`POST /appraisals/consignment/:id`（验真报价，接受则生成商品）、
  `GET /appraisals/consignment/:id`
- `GET /items`（买家仅见在售且不含旧照片归档）、`GET /items/:id`（内部角色额外返回归档照片与超预算单）、
  `POST /items/:id/work-logs`（清洁/补漆/维修/拍照/文案/入库）、`POST /items/:id/advance`（状态推进/上架）、
  `POST /items/:id/rephotograph`（翻新后重拍+更新瑕疵说明，旧照片转内部审计）
- `POST /refurbish/items/:itemId/overrun`（仓库/翻新师发起超预算确认）、
  `GET /refurbish/overruns`（支持 status/itemId 过滤；卖家仅见自己的）、
  `GET /refurbish/overruns/:id`、
  `POST /refurbish/overruns/:id/decision`（卖家 ACCEPT / REJECT_REDUCE / REJECT_CANCEL）
- `POST /orders`（买家下单，含配送费试算）、`GET /orders`、`GET /orders/:id`、`POST /orders/:id/cancel`
- `GET /deliveries/queue`、`POST /deliveries/:orderId/schedule|load|done|fail`
- `POST /tickets`（任意相关方发起异常）、`GET /tickets`、`GET /tickets/:id`、
  `POST /tickets/:id/messages`（六方协同留言）、`POST /tickets/:id/resolve`（客服裁定）
- `GET /settlements`、`GET /settlements/order/:orderId`、`POST /settlements/order/:orderId/generate`
- `GET /analytics/by-category`（品类指标与渠道建议）、
  `GET /analytics/seller-profiles`、`GET /analytics/seller-profiles/:sellerId`、
  `GET /analytics/appraiser-deviations`（估价师偏差考核，仅 OPS/ADMIN）

## 九、目录结构

```
.
├── docker-compose.yml          # db + backend + frontend 一键启动
├── backend/                    # NestJS + TypeORM + PostgreSQL
│   ├── Dockerfile
│   ├── src/
│   │   ├── entities/           # 11 张核心表（含 refurbish_overrun_confirmations）
│   │   ├── auth/               # JWT + 角色守卫
│   │   ├── risk/               # 卖家风险画像（全局服务；估价偏差取消不计反悔）
│   │   ├── consignments/ appraisals/ items/ refurbish/ orders/
│   │   ├── deliveries/ tickets/ settlements/ analytics/ seeder/
│   │   └── main.ts
│   └── e2e-test.sh             # 48 项端到端断言
└── frontend/                   # React + Vite
    ├── Dockerfile  nginx.conf
    └── src/views/              # 登录 + 各角色工作台（含 Overrun.tsx 卖家预算确认）
```
