import { useEffect, useState } from 'react';
import { api } from '../api';
import {
  Badge, Modal, Field, Money, Empty, toast, useLoader,
} from '../ui';
import { CATEGORY, ITEM_STATUS, ORDER_STATUS, TICKET_TYPE, TICKET_STATUS } from '../labels';
import { TicketDetail } from './TicketDetail';

const EMOJI: Record<string, string> = {
  SOFA: '🛋️', DINING_TABLE: '🍽️', KIDS_BED: '🛏️',
  BOOKCASE: '📚', OFFICE_CHAIR: '💺', APPLIANCE_CABINET: '🗄️',
};

export function BuyerView({ mode }: { mode: 'market' | 'orders' }) {
  return mode === 'market' ? <Market /> : <MyOrders />;
}

function Market() {
  const [items, setItems] = useState<any[]>([]);
  const [cat, setCat] = useState('');
  const [buyItem, setBuyItem] = useState<any>(null);

  const load = () => {
    api('/items' + (cat ? `?category=${cat}` : '')).then(setItems);
  };
  useEffect(load, [cat]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>寄卖市场</h2>
          <div className="sub">全部商品已完成上门验真与清洁翻新；配送范围/电梯适配以下单时计价为准</div>
        </div>
      </div>
      <div className="pill-filter">
        <button className={cat === '' ? 'active' : ''} onClick={() => setCat('')}>全部</button>
        {Object.entries(CATEGORY).map(([k, v]) => (
          <button key={k} className={cat === k ? 'active' : ''} onClick={() => setCat(k)}>{v}</button>
        ))}
      </div>
      {items.length === 0 ? (
        <Empty text="暂无在售商品" />
      ) : (
        <div className="grid grid-3">
          {items.map((it) => (
            <div className="card" key={it.id}>
              <div className="item-photo" style={{ background: gradientFor(it.category) }}>
                {EMOJI[it.category]}
              </div>
              <h3 style={{ fontSize: 14.5 }}>{it.title}</h3>
              <div style={{ margin: '4px 0' }}>
                <span className="price" style={{ fontSize: 17 }}><Money v={it.listedPrice} /></span>
                <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>底价 <Money v={it.minDealPrice} /></span>
              </div>
              <div style={{ marginBottom: 8 }}>
                <span className="tag">{it.location === 'WAREHOUSE' ? '在仓现货' : '卖家家中'}</span>
                <span className="tag">
                  {String(it.deliveryRadiusKm) === '0'
                    ? '仅同城自提'
                    : `可配送 ${it.deliveryRadiusKm}km`}
                </span>
                {it.disassemblable && <span className="tag">可拆装</span>}
              </div>
              <p className="muted" style={{ fontSize: 12.5, minHeight: 38 }}>
                {it.description?.slice(0, 56) || ''}
                {it.description?.length > 56 ? '…' : ''}
              </p>
              {it.defectNote && (
                <div className="hint" style={{ marginBottom: 8, fontSize: 12 }}>
                  翻新后成色说明：{it.defectNote}
                </div>
              )}
              <button className="btn sm" style={{ width: '100%' }} onClick={() => setBuyItem(it)}>
                立即下单
              </button>
            </div>
          ))}
        </div>
      )}
      {buyItem && <BuyModal item={buyItem} onClose={() => setBuyItem(null)} onDone={() => { setBuyItem(null); load(); toast('下单成功，请等待配送排班'); }} />}
    </div>
  );
}

function gradientFor(cat: string) {
  const colors: Record<string, string> = {
    SOFA: 'linear-gradient(135deg,#0f766e,#14b8a6)',
    DINING_TABLE: 'linear-gradient(135deg,#92400e,#d97706)',
    KIDS_BED: 'linear-gradient(135deg,#1d4ed8,#60a5fa)',
    BOOKCASE: 'linear-gradient(135deg,#6d28d9,#a78bfa)',
    OFFICE_CHAIR: 'linear-gradient(135deg,#15803d,#4ade80)',
    APPLIANCE_CABINET: 'linear-gradient(135deg,#475569,#94a3b8)',
  };
  return colors[cat] || '#0f766e';
}

function BuyModal({ item, onClose, onDone }: { item: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    buyerAddress: '',
    buyerFloor: 1,
    buyerElevator: 'ELEVATOR',
    needOldFurnitureRemoval: false,
    appointmentWindow: '',
    dealPrice: Number(item.listedPrice),
  });
  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));
  const { loading, error, run } = useLoader();
  const selfPickup = String(item.deliveryRadiusKm) === '0';
  const fee = (() => {
    if (selfPickup) return 0;
    let fee = 60;
    if (f.buyerElevator !== 'ELEVATOR') fee += Math.max(0, f.buyerFloor - 1) * 15;
    if (f.needOldFurnitureRemoval) fee += 80;
    return fee;
  })();

  return (
    <Modal
      title={`下单 · ${item.title}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn gray" onClick={onClose}>取消</button>
          <button
            className="btn"
            disabled={loading}
            onClick={() =>
              run(
                () => api('/orders', { body: { itemId: item.id, ...f } }),
                undefined,
                onDone,
              )
            }
          >
            确认下单（合计 <Money v={Number(f.dealPrice) + fee} />）
          </button>
        </>
      }
    >
      <div className="banner info">
        寄卖价 <Money v={item.listedPrice} />，最低成交价 <Money v={item.minDealPrice} />，出价不可低于底价。
      </div>
      <div className="row2">
        <Field label="成交出价（元）">
          <input type="number" value={f.dealPrice} onChange={(e) => set('dealPrice', +e.target.value)} />
        </Field>
        <Field label="期望送达时间">
          <input placeholder="如 10-06 下午" value={f.appointmentWindow} onChange={(e) => set('appointmentWindow', e.target.value)} />
        </Field>
        <Field label="收货楼层">
          <input type="number" min={1} value={f.buyerFloor} onChange={(e) => set('buyerFloor', +e.target.value)} />
        </Field>
        <Field label="电梯条件">
          <select value={f.buyerElevator} onChange={(e) => set('buyerElevator', e.target.value)}>
            <option value="ELEVATOR">有电梯</option>
            <option value="NO_ELEVATOR">无电梯</option>
            <option value="WALKUP">楼梯房</option>
          </select>
        </Field>
      </div>
      <Field label="收货地址">
        <input value={f.buyerAddress} onChange={(e) => set('buyerAddress', e.target.value)} placeholder="小区+门牌" />
      </Field>
      <label className="checkline" style={{ marginBottom: 10 }}>
        <input
          type="checkbox"
          checked={f.needOldFurnitureRemoval}
          onChange={(e) => set('needOldFurnitureRemoval', e.target.checked)}
          disabled={selfPickup}
        />
        需要配送团队搬出旧家具（+¥80）
      </label>
      <div className="card" style={{ background: '#f8fafc' }}>
        <b>费用预估</b>
        <div className="hint" style={{ marginTop: 6 }}>
          {selfPickup
            ? '该商品仅支持同城自提，无配送费。'
            : `基础配送 ¥60${f.buyerElevator !== 'ELEVATOR' ? ` + 无电梯 ${Math.max(0, f.buyerFloor - 1)} 层 × ¥15` : ''}${f.needOldFurnitureRemoval ? ' + 旧家具搬出 ¥80' : ''} = ¥${fee}`}
        </div>
        <div className="hint">
          大件请先确认电梯轿厢/楼道尺寸；若因进不了电梯导致配送失败，可在工单中协商处理。
        </div>
      </div>
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}

function MyOrders() {
  const [orders, setOrders] = useState<any[]>([]);
  const [ticketFor, setTicketFor] = useState<any>(null);
  const [ticketId, setTicketId] = useState<string | null>(null);

  const load = () => {
    api('/orders').then(setOrders);
  };
  useEffect(() => {
    load();
  }, []);

  if (ticketId) return <TicketDetail id={ticketId} onBack={() => { setTicketId(null); load(); }} />;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>我的订单与售后</h2>
          <div className="sub">到货色差、磕碰、退货等问题可直接发起协同工单，客服与各环节会围绕这件家具处理</div>
        </div>
      </div>
      {orders.length === 0 ? (
        <Empty text="还没有订单" />
      ) : (
        <div className="grid">
          {orders.map((o) => (
            <div className="card" key={o.id}>
              <h3>
                {o.code}
                <span style={{ marginLeft: 8 }}><Badge map={ORDER_STATUS} value={o.status} /></span>
                <span style={{ float: 'right' }}><Money v={o.dealPrice} className="price" /></span>
              </h3>
              <dl className="kv">
                <dt>配送费</dt><dd><Money v={o.deliveryFee} /></dd>
                <dt>预约时间</dt><dd>{o.appointmentWindow || '待排班'}</dd>
                <dt>地址</dt><dd>{o.buyerAddress}（{o.buyerFloor} 层）</dd>
                <dt>旧家具搬出</dt><dd>{o.needOldFurnitureRemoval ? '是' : '否'}</dd>
              </dl>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                {['DELIVERED', 'IN_DELIVERY', 'DELIVERY_SCHEDULED'].includes(o.status) && (
                  <button className="btn ghost sm" onClick={() => setTicketFor(o)}>发起售后/异常工单</button>
                )}
                {o.status === 'CREATED' && (
                  <button
                    className="btn danger sm"
                    onClick={async () => {
                      if (!confirm('确认取消该订单？')) return;
                      try {
                        await api(`/orders/${o.id}/cancel`);
                        toast('订单已取消');
                        load();
                      } catch (e: any) {
                        toast(e.message, true);
                      }
                    }}
                  >
                    取消订单
                  </button>
                )}
                {['SETTLED', 'RETURNED'].includes(o.status) && (
                  <button className="btn gray sm" onClick={() => setTicketId('')} disabled>已完结</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {ticketFor && <CreateTicketModal order={ticketFor} onClose={() => setTicketFor(null)} onCreated={(id: string) => { setTicketFor(null); setTicketId(id); }} />}
    </div>
  );
}

function CreateTicketModal({ order, onClose, onCreated }: { order: any; onClose: () => void; onCreated: (id: string) => void }) {
  const [f, setF] = useState({ type: 'COLOR_DIFFERENCE', title: '', description: '' });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    if (!f.title || !f.description) return toast('请填写标题和描述', true);
    setBusy(true);
    try {
      const res = await api('/tickets', { body: { orderId: order.id, ...f } });
      toast('工单已创建，客服将尽快介入');
      onCreated(res.ticket.id);
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`发起售后工单 · ${order.code}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn gray" onClick={onClose}>取消</button>
          <button className="btn" disabled={busy} onClick={submit}>提交工单</button>
        </>
      }
    >
      <Field label="问题类型">
        <select value={f.type} onChange={(e) => set('type', e.target.value)}>
          {Object.entries(TICKET_TYPE)
            .filter(([k]) => k !== 'SELLER_BACKTRACK' && k !== 'APPRAISAL_MISMATCH')
            .map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
        </select>
      </Field>
      <Field label="标题">
        <input value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="一句话说明问题" />
      </Field>
      <Field label="详细描述（可写现场情况、照片链接、诉求）">
        <textarea style={{ minHeight: 100 }} value={f.description} onChange={(e) => set('description', e.target.value)} />
      </Field>
    </Modal>
  );
}
