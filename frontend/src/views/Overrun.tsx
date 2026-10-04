import { useEffect, useState } from 'react';
import { api, AuthUser } from '../api';
import { Badge, Modal, Field, Money, Empty, toast } from '../ui';
import { OVERRUN_STATUS } from '../labels';

/**
 * 卖家侧「翻新成本超预算确认」：
 * 接受 → 追加费用从成交款扣除；拒绝 → 降价上架 或 取消寄卖（不计卖家反悔）。
 * 估价偏差原因仅平台内部保留，卖家不可见。
 */
export function SellerOverrunList({ user }: { user: AuthUser }) {
  const [rows, setRows] = useState<any[]>([]);
  const [status, setStatus] = useState('PENDING');
  const [decideFor, setDecideFor] = useState<any>(null);

  const load = () =>
    api(`/refurbish/overruns?status=${status === 'ALL' ? '' : status}`).then((r: any) => setRows(r || []));
  useEffect(() => { load(); }, [status]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>翻新预算确认</h2>
          <div className="sub">
            仓库清洁时发现瑕疵比估价时严重（如餐桌划痕需重新打磨上漆），平台会把新增工时、材料费、
            预计售价变化与上架时间影响推送给你确认
          </div>
        </div>
      </div>
      <div className="pill-filter">
        {[['PENDING', '待我确认'], ['ACCEPTED', '已接受'], ['REJECTED_REDUCE', '拒绝·降价'], ['REJECTED_CANCEL', '拒绝·取消'], ['ALL', '全部']].map(
          ([k, v]) => (
            <button key={k} className={status === k ? 'active' : ''} onClick={() => setStatus(k)}>{v}</button>
          ),
        )}
      </div>
      {rows.length === 0 ? (
        <Empty text={status === 'PENDING' ? '暂无待确认的超预算通知' : '暂无确认单'} />
      ) : (
        <div className="grid">
          {rows.map((r) => (
            <OverrunCard key={r.id} row={r} onDecide={() => setDecideFor(r)} />
          ))}
        </div>
      )}
      {decideFor && (
        <DecisionModal
          row={decideFor}
          onClose={() => setDecideFor(null)}
          onDone={() => { setDecideFor(null); load(); }}
        />
      )}
    </div>
  );
}

export function OverrunCard({ row, onDecide }: { row: any; onDecide?: () => void }) {
  const extra = Number(row.additionalLaborCost) + Number(row.additionalMaterialCost);
  const priceDelta = Number(row.revisedListedPrice) - Number(row.currentListedPrice);
  return (
    <div className="card" key={row.id}>
      <h3>
        {row.code}
        <span style={{ marginLeft: 8 }}><Badge map={OVERRUN_STATUS} value={row.status} /></span>
        {onDecide && row.status === 'PENDING' && (
          <span style={{ float: 'right' }}>
            <button className="btn sm" onClick={onDecide}>去确认</button>
          </span>
        )}
      </h3>
      <div className="muted" style={{ marginBottom: 8 }}>{row.itemTitle || '-'}</div>
      <p style={{ margin: '4px 0 10px' }}>{row.reason}</p>
      <dl className="kv">
        <dt>估价时预估翻新</dt><dd><Money v={row.estimatedRefurbishCost} /></dd>
        <dt>确认前已发生</dt><dd><Money v={row.incurredRefurbishCost} /></dd>
        <dt>新增工时费</dt><dd><Money v={row.additionalLaborCost} /></dd>
        <dt>新增材料费</dt><dd><Money v={row.additionalMaterialCost} /></dd>
        <dt>追加合计</dt><dd className="money-out"><Money v={extra} />（接受后从成交款扣除）</dd>
        <dt>预计售价</dt>
        <dd>
          <Money v={row.currentListedPrice} /> → <Money v={row.revisedListedPrice} />
          <span className="muted">（{priceDelta >= 0 ? '+' : ''}{priceDelta.toFixed(2)}）</span>
        </dd>
        <dt>上架时间</dt>
        <dd>{row.affectListing ? `受影响，预计延后约 ${row.listingDelayDays} 天` : '不受影响'}</dd>
        {row.beforePhotos?.length > 0 && (
          <>
            <dt>翻新前照片</dt>
            <dd>{row.beforePhotos.map((p: string, i: number) => (
              <a key={i} href={p} target="_blank" rel="noreferrer" className="tag">照片{i + 1}</a>
            ))}</dd>
          </>
        )}
        {row.sellerDecisionNote && (
          <>
            <dt>我的回复</dt><dd>{row.sellerDecisionNote}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

function DecisionModal({ row, onClose, onDone }: { row: any; onClose: () => void; onDone: () => void }) {
  const [choice, setChoice] = useState<'ACCEPT' | 'REJECT_REDUCE' | 'REJECT_CANCEL'>('ACCEPT');
  const [reducedPrice, setReducedPrice] = useState<number>(
    Math.max(0, Math.floor(Number(row.currentListedPrice) * 0.9)),
  );
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const extra = Number(row.additionalLaborCost) + Number(row.additionalMaterialCost);

  const submit = async () => {
    if (choice === 'REJECT_REDUCE' && !(reducedPrice > 0)) {
      return toast('请填写降价后的挂牌价', true);
    }
    setBusy(true);
    try {
      await api(`/refurbish/overruns/${row.id}/decision`, {
        body: {
          decision: choice,
          reducedPrice: choice === 'REJECT_REDUCE' ? reducedPrice : undefined,
          note,
        },
      });
      toast(
        choice === 'ACCEPT'
          ? '已接受，追加翻新费将在成交后从成交款扣除'
          : choice === 'REJECT_REDUCE'
            ? '已拒绝追加翻新，商品按降价后价格上架'
            : '已取消寄卖（因估价偏差导致，不计入卖家反悔记录）',
      );
      onDone();
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      wide
      title={`确认翻新方案 · ${row.code}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn gray" onClick={onClose}>再想想</button>
          <button className="btn" disabled={busy} onClick={submit}>提交决定</button>
        </>
      }
    >
      <div className="banner info">
        {row.reason}
      </div>
      <div className="card" style={{ background: '#f8fafc' }}>
        需要追加 <b className="money-out"><Money v={extra} /></b>（工时 <Money v={row.additionalLaborCost} /> +
        材料 <Money v={row.additionalMaterialCost} />）；预计售价 <Money v={row.currentListedPrice} /> →
        <Money v={row.revisedListedPrice} />；{row.affectListing ? `上架延后约 ${row.listingDelayDays} 天` : '不影响上架时间'}。
      </div>
      <div className="row2" style={{ marginTop: 10 }}>
        <label className="checkline" style={{ alignItems: 'flex-start' }}>
          <input type="radio" checked={choice === 'ACCEPT'} onChange={() => setChoice('ACCEPT')} />
          <span>
            <b>接受追加翻新</b>
            <div className="hint">继续打磨上漆，追加费用成交后从成交款扣除，按新预计售价上架</div>
          </span>
        </label>
        <label className="checkline" style={{ alignItems: 'flex-start' }}>
          <input type="radio" checked={choice === 'REJECT_REDUCE'} onChange={() => setChoice('REJECT_REDUCE')} />
          <span>
            <b>拒绝，商品降价上架</b>
            <div className="hint">不再追加翻新，按现状以更低价格直接上架，追加费用不发生</div>
          </span>
        </label>
        <label className="checkline" style={{ alignItems: 'flex-start' }}>
          <input type="radio" checked={choice === 'REJECT_CANCEL'} onChange={() => setChoice('REJECT_CANCEL')} />
          <span>
            <b>拒绝，取消寄卖</b>
            <div className="hint">商品下架、寄卖终止；因平台估价偏差导致，不计入你的反悔记录</div>
          </span>
        </label>
      </div>
      {choice === 'REJECT_REDUCE' && (
        <Field label={`降价后挂牌价（须低于当前价 ¥${row.currentListedPrice}）`}>
          <input type="number" min={0} value={reducedPrice} onChange={(e) => setReducedPrice(+e.target.value)} />
        </Field>
      )}
      <Field label="备注（可选）">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="想对平台说的话" />
      </Field>
    </Modal>
  );
}
