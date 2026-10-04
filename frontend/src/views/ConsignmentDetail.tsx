import { useEffect, useState } from 'react';
import { api } from '../api';
import {
  Badge, Money, Empty, ScoreDots, toast,
} from '../ui';
import { CATEGORY, ELEVATOR, CONSIGNMENT_STATUS, MATCH_RESULT, ITEM_STATUS, WORK_LOG_TYPE, ORDER_STATUS, TICKET_TYPE, TICKET_STATUS, SETTLEMENT_TYPE, OVERRUN_STATUS } from '../labels';
import { TicketDetail } from './TicketDetail';

const INTERNAL_ROLES = ['WAREHOUSE', 'REFURBISHER', 'CS', 'OPS', 'ADMIN', 'APPRAISER', 'DELIVERY'];

export function ConsignmentDetail({
  id,
  onBack,
  viewerRole,
}: {
  id: string;
  onBack: () => void;
  viewerRole: string;
}) {
  const [data, setData] = useState<any>(null);
  const [itemDetail, setItemDetail] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [tickets, setTickets] = useState<any[]>([]);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    api(`/consignments/${id}`).then(setData);
    api('/orders').then(setOrders).catch(() => {});
    api('/tickets').then(setTickets).catch(() => {});
  };
  useEffect(() => {
    load();
  }, [id]);

  useEffect(() => {
    if (data?.itemId || data) {
      // item 信息由 /items/:id 拉（通过 consignment 关联需先从估价响应中拿不到 itemId，借助列表接口）
    }
  }, [data]);

  // 通过商品列表找到该寄卖对应商品
  useEffect(() => {
    api('/items').then(async (items: any[]) => {
      const it = items.find((x) => x.consignmentId === id);
      if (it) setItemDetail(await api(`/items/${it.id}`));
    }).catch(() => {});
  }, [id, data]);

  if (!data) return <div className="empty">加载中…</div>;

  const c = data;
  const a = c.appraisal || itemDetail?.appraisal || null;
  const item = itemDetail?.item || null;
  const logs = itemDetail?.workLogs || [];
  const overruns = itemDetail?.overrunConfirmations || [];
  const internal = INTERNAL_ROLES.includes(viewerRole);
  const relatedOrders = orders.filter((o) => o.consignmentId === id);
  const relatedTickets = tickets.filter((t) => t.consignmentId === id);

  const cancel = async () => {
    if (!confirm('确认反悔并撤销该寄卖？该记录将计入你的卖家信用画像。')) return;
    setBusy(true);
    try {
      await api(`/consignments/${id}/cancel`, { body: { reason: '卖家主动撤销' } });
      toast('已撤销寄卖');
      load();
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  if (ticketId) {
    return <TicketDetail id={ticketId} onBack={() => { setTicketId(null); load(); }} />;
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <button className="btn ghost sm" onClick={onBack}>← 返回</button>
          <h2 style={{ marginTop: 10 }}>
            {c.code} · {CATEGORY[c.category]} · {c.brand}
            <span style={{ marginLeft: 10 }}><Badge map={CONSIGNMENT_STATUS} value={c.status} /></span>
            {c.verificationLevel === 'STRICT' && (
              <span className="badge red" style={{ marginLeft: 6 }}>严格验真</span>
            )}
          </h2>
          <div className="sub">卖家：{c.sellerName}</div>
        </div>
        {viewerRole === 'SELLER' &&
          ['SUBMITTED', 'APPRAISAL_SCHEDULED', 'APPRAISED'].includes(c.status) && (
            <button className="btn danger" disabled={busy} onClick={cancel}>卖家反悔/撤销</button>
          )}
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h3>申报信息</h3>
          <dl className="kv">
            <dt>尺寸</dt><dd>{c.sizeText}</dd>
            <dt>材质</dt><dd>{c.material}</dd>
            <dt>使用年限</dt><dd>{c.yearsUsed} 年</dd>
            <dt>楼层/电梯</dt><dd>{c.floor} 层 · {ELEVATOR[c.elevator]}</dd>
            <dt>可拆装</dt><dd>{c.disassemblable ? '是' : '否'}</dd>
            <dt>期望售价</dt><dd><Money v={c.expectedPrice} /></dd>
            <dt>接受翻新</dt><dd>{c.acceptRefurbish ? '是' : '否'}</dd>
            <dt>地址</dt><dd>{c.address || '-'}</dd>
            <dt>瑕疵照片</dt>
            <dd>{c.defectPhotos?.length ? c.defectPhotos.map((p: string, i: number) => (
              <a key={i} href={p} target="_blank" rel="noreferrer" className="tag">照片{i + 1}</a>
            )) : '无'}</dd>
            <dt>备注</dt><dd>{c.sellerNote || '-'}</dd>
          </dl>
        </div>

        <div className="card">
          <h3>上门验真与估价</h3>
          {!a ? (
            <Empty text="估价师尚未完成上门验真" />
          ) : (
            <>
              <dl className="kv">
                <dt>结构</dt><dd><ScoreDots n={a.structuralScore} /></dd>
                <dt>污渍</dt><dd><ScoreDots n={a.stainScore} /></dd>
                <dt>异味</dt><dd><ScoreDots n={a.odorScore} /></dd>
                <dt>虫蛀</dt><dd><ScoreDots n={a.mothScore} /></dd>
                <dt>板材变形</dt><dd><ScoreDots n={a.warpScore} /></dd>
                <dt>搬运难度</dt><dd><ScoreDots n={a.moveDifficulty} /></dd>
                <dt>实物相符度</dt><dd><Badge map={MATCH_RESULT} value={a.matchResult} /> {a.matchNote}</dd>
                <dt>寄卖价</dt><dd className="price"><Money v={a.consignmentPrice} /></dd>
                <dt>最低成交价</dt><dd><Money v={a.minDealPrice} /></dd>
                <dt>平台佣金</dt><dd>{(Number(a.commissionRate) * 100).toFixed(1)}%</dd>
                <dt>预估翻新成本</dt><dd><Money v={a.estimatedRefurbishCost} /></dd>
                <dt>清洁建议</dt><dd>{a.cleaningAdvice || '-'}</dd>
                <dt>翻新建议</dt><dd>{a.refurbishSuggestions || '-'}</dd>
              </dl>
            </>
          )}
        </div>
      </div>

      {item && (
        <div className="card" style={{ marginTop: 14 }}>
          <h3>
            商品与仓储：{item.title}
            <span style={{ marginLeft: 8 }}><Badge map={ITEM_STATUS} value={item.status} /></span>
            <span className="tag" style={{ marginLeft: 8 }}>
              {item.location === 'WAREHOUSE' ? '在仓' : '仍在卖家家中'}
            </span>
            {item.warehouseSlot && <span className="tag">库位 {item.warehouseSlot}</span>}
            <span className="tag">可配送 {item.deliveryRadiusKm}km{String(item.deliveryRadiusKm) === '0' ? '（仅同城自提）' : ''}</span>
          </h3>
          <p style={{ margin: '4px 0 10px' }}>{item.description || '上架描述待完善'}</p>
          {item.defectNote && (
            <div className="banner info" style={{ marginBottom: 10 }}>
              <b>翻新后瑕疵说明（买家所见真实状态）</b>
              <div style={{ marginTop: 4 }}>{item.defectNote}</div>
            </div>
          )}
          {item.photos?.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <b>当前照片（翻新后）：</b>{' '}
              {item.photos.map((p: string, i: number) => (
                <a key={i} href={p} target="_blank" rel="noreferrer" className="tag">照片{i + 1}</a>
              ))}
            </div>
          )}
          {internal && item.archivedPhotos?.length > 0 && (
            <div className="banner warn" style={{ marginBottom: 10 }}>
              <b>内部审计 · 翻新前旧照片（买家/卖家不可见）</b>
              <div style={{ marginTop: 4 }}>
                {item.archivedPhotos.map((p: string, i: number) => (
                  <a key={i} href={p} target="_blank" rel="noreferrer" className="tag">旧照片{i + 1}</a>
                ))}
              </div>
              {item.archivedDefectNote && (
            <div className="hint" style={{ color: 'inherit', marginTop: 6 }}>
              旧瑕疵说明：{item.archivedDefectNote}
            </div>
          )}
        </div>
      )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>作业</th><th>说明</th><th>费用</th><th>时间</th></tr>
              </thead>
              <tbody>
                {logs.length === 0 && <tr><td colSpan={4} className="muted">暂无作业记录</td></tr>}
                {logs.map((l: any) => (
                  <tr key={l.id}>
                    <td>{WORK_LOG_TYPE[l.type]}</td>
                    <td>{l.note || '-'}</td>
                    <td><Money v={l.cost} /></td>
                    <td className="muted">{new Date(l.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="hint">
            已发生：清洁费 <Money v={item.cleaningCost} /> · 翻新费 <Money v={item.refurbishCost} />
          </div>
          {overruns.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <b>翻新成本超预算确认</b>
              <div className="table-wrap" style={{ marginTop: 6 }}>
                <table>
                  <thead>
                    <tr>
                      <th>单号</th><th>新增工时</th><th>新增材料</th><th>售价变化</th>
                      <th>上架影响</th><th>状态</th>
                      {internal && <th>估价偏差原因（考核）</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {overruns.map((o: any) => (
                      <tr key={o.id}>
                        <td>{o.code}</td>
                        <td><Money v={o.additionalLaborCost} /></td>
                        <td><Money v={o.additionalMaterialCost} /></td>
                        <td><Money v={o.currentListedPrice} /> → <Money v={o.revisedListedPrice} /></td>
                        <td>{o.affectListing ? `延后约 ${o.listingDelayDays} 天` : '不影响'}</td>
                        <td><Badge map={OVERRUN_STATUS} value={o.status} /></td>
                        {internal && <td className="muted">{o.deviationReason || '-'}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="section-title">订单与配送</div>
      {relatedOrders.length === 0 ? (
        <div className="card"><Empty text="暂无订单" /></div>
      ) : (
        <div className="grid">
          {relatedOrders.map((o) => (
            <OrderCard key={o.id} order={o} />
          ))}
        </div>
      )}

      <div className="section-title">协同工单</div>
      {relatedTickets.length === 0 ? (
        <div className="card"><Empty text="暂无异常工单" /></div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>类型</th><th>标题</th><th>状态</th><th>裁定</th><th></th></tr></thead>
              <tbody>
                {relatedTickets.map((t) => (
                  <tr key={t.id}>
                    <td>{TICKET_TYPE[t.type]}</td>
                    <td>{t.title}</td>
                    <td><Badge map={TICKET_STATUS} value={t.status} /></td>
                    <td className="muted">{t.resolution === 'PENDING' ? '待裁定' : t.resolution}{Number(t.compensationAmount) > 0 ? ` · ¥${t.compensationAmount}` : ''}</td>
                    <td><button className="btn ghost sm" onClick={() => setTicketId(t.id)}>进入协同</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function OrderCard({ order }: { order: any }) {
  const [detail, setDetail] = useState<any>(null);
  const [settlement, setSettlement] = useState<any>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api(`/orders/${order.id}`).then(setDetail).catch(() => {});
    api(`/settlements/order/${order.id}`).then(setSettlement).catch(() => {});
  }, [order.id]);

  return (
    <div className="card clickable" onClick={() => setOpen(!open)}>
      <h3>
        {order.code}
        <span style={{ marginLeft: 8 }}><Badge map={ORDER_STATUS} value={order.status} /></span>
        <span style={{ float: 'right' }}><Money v={order.dealPrice} className="price" /></span>
      </h3>
      <div className="muted" style={{ fontSize: 12.5 }}>
        配送费 <Money v={order.deliveryFee} /> · 预约 {order.appointmentWindow || '待排班'}
        {detail?.delivery && (
          <>
            {' · '}
            {detail.delivery.status === 'FAILED'
              ? `配送失败：${detail.delivery.failReason === 'ELEVATOR_TOO_SMALL' ? '进不了电梯' : detail.delivery.failReason}`
              : `配送${detail.delivery.status}`}
          </>
        )}
      </div>
      {order.deliveryNote && <div className="hint">签收备注：{order.deliveryNote}</div>}
      {open && settlement && (
        <div style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            结算明细（卖家应得 <Money v={settlement.settlement.sellerPayout} className="money-in" />
            ，平台净收入 <Money v={settlement.settlement.platformIncome} />）
          </div>
          {settlement.entries.map((e: any) => (
            <div key={e.id} className="timeline-item">
              <b>{SETTLEMENT_TYPE[e.type]} <Money v={e.amount} /></b>
              <div className="muted">{e.source}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
