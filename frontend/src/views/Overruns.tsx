import { useEffect, useState } from 'react';
import { api } from '../api';
import {
  Badge, Modal, Field, Money, Empty, toast,
} from '../ui';
import {
  OVERRUN_STATUS, DEVIATION_CATEGORY, ITEM_STATUS,
} from '../labels';

/**
 * 卖家端：翻新成本超预算确认。
 * 仓库清洁时发现估价时未预见的损伤，平台把新增工时、材料费、
 * 预计售价变化与是否影响上架时间推给卖家：
 *  - 接受：追加费用翻新完成后从成交款扣除
 *  - 拒绝追加：商品可按现状降价上架
 *  - 取消寄卖
 */
export function SellerOverrunsView() {
  const [rows, setRows] = useState<any[]>([]);
  const [decideFor, setDecideFor] = useState<any>(null);
  const [detailFor, setDetailFor] = useState<any>(null);

  const load = () => {
    api('/refurbish-overruns').then(setRows);
  };
  useEffect(load, []);

  const pending = rows.filter((r) => r.status === 'PENDING_SELLER');
  const history = rows.filter((r) => r.status !== 'PENDING_SELLER');

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>翻新预算确认</h2>
          <div className="sub">
            清洁翻新中发现估价时未预见的问题时，仓库会把新增工时、材料费、售价变化和上架时间影响推送给你确认
          </div>
        </div>
      </div>

      <div className="section-title">待我确认</div>
      {pending.length === 0 ? (
        <div className="card"><Empty text="暂无待确认的超预算单据" /></div>
      ) : (
        <div className="grid">
          {pending.map((r) => (
            <div className="card" key={r.id}>
              <h3>
                {r.itemTitle || '翻新商品'}
                <span style={{ marginLeft: 8 }}><Badge map={OVERRUN_STATUS} value={r.status} /></span>
              </h3>
              <div className="banner risk" style={{ marginTop: 4 }}>
                {r.reason}
              </div>
              <dl className="kv" style={{ marginTop: 8 }}>
                <dt>估价时翻新预算</dt><dd><Money v={r.budgetedRefurbishCost} /></dd>
                <dt>确认前已发生</dt><dd><Money v={r.incurredRefurbishCost} /></dd>
                <dt>新增工时费</dt><dd><Money v={r.extraLaborCost} /></dd>
                <dt>新增材料费</dt><dd><Money v={r.extraMaterialCost} /></dd>
                <dt>追加预算合计</dt><dd className="price"><Money v={r.extraTotal} /></dd>
                <dt>当前挂牌价</dt><dd><Money v={r.currentListedPrice} /></dd>
                <dt>翻新后建议价</dt><dd><Money v={r.suggestedPrice} /></dd>
                <dt>上架时间</dt><dd>{r.listingImpact === 'DELAY' ? `预计推迟约 ${r.delayDays} 天` : '不影响上架时间'}</dd>
              </dl>
              {r.priceImpactNote && <div className="hint">售价变化：{r.priceImpactNote}</div>}
              {r.discoveryPhotos?.length > 0 && (
                <div className="hint">
                  仓库发现损伤照片（内部留档）：
                  {r.discoveryPhotos.map((p: string, i: number) => (
                    <a key={i} href={p} target="_blank" rel="noreferrer" className="tag" style={{ marginLeft: 4 }}>照片{i + 1}</a>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn" onClick={() => setDecideFor({ row: r, decision: 'ACCEPT' })}>
                  接受（费用成交款扣除）
                </button>
                <button className="btn ghost" onClick={() => setDecideFor({ row: r, decision: 'REDUCE_LIST' })}>
                  拒绝·降价上架
                </button>
                <button className="btn danger" onClick={() => setDecideFor({ row: r, decision: 'CANCEL_CONSIGNMENT' })}>
                  拒绝·取消寄卖
                </button>
              </div>
              <div style={{ marginTop: 8 }}>
                <button className="btn gray sm" onClick={() => setDetailFor(r)}>查看完整单据</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="section-title">历史确认</div>
      {history.length === 0 ? (
        <div className="card"><Empty text="暂无历史单据" /></div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>单号</th><th>商品</th><th>追加预算</th><th>建议售价</th><th>上架影响</th><th>我的决定</th><th></th></tr>
              </thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.id}>
                    <td>{r.code}</td>
                    <td>{r.itemTitle}</td>
                    <td><Money v={r.extraTotal} /></td>
                    <td><Money v={r.suggestedPrice} /></td>
                    <td>{r.listingImpact === 'DELAY' ? `推迟 ${r.delayDays} 天` : '不影响'}</td>
                    <td><Badge map={OVERRUN_STATUS} value={r.status} /></td>
                    <td><button className="btn ghost sm" onClick={() => setDetailFor(r)}>详情</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {decideFor && (
        <DecideModal
          data={decideFor}
          onClose={() => setDecideFor(null)}
          onDone={() => { setDecideFor(null); load(); }}
        />
      )}
      {detailFor && (
        <OverrunDetailModal
          id={detailFor.id}
          onClose={() => setDetailFor(null)}
        />
      )}
    </div>
  );
}

function DecideModal({
  data,
  onClose,
  onDone,
}: {
  data: { row: any; decision: 'ACCEPT' | 'REDUCE_LIST' | 'CANCEL_CONSIGNMENT' };
  onClose: () => void;
  onDone: () => void;
}) {
  const { row, decision } = data;
  const [note, setNote] = useState('');
  const [reducedPrice, setReducedPrice] = useState(
    Math.max(0, Math.round(Number(row.currentListedPrice) * 0.9)),
  );
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api(`/refurbish-overruns/${row.id}/decide`, {
        body: {
          decision,
          sellerNote: note,
          reducedPrice: decision === 'REDUCE_LIST' ? reducedPrice : undefined,
        },
      });
      const msg =
        decision === 'ACCEPT'
          ? '已接受追加预算，翻新继续，费用将在成交结算时扣除'
          : decision === 'REDUCE_LIST'
            ? '已选择按现状降价上架，仓库将重新拍摄后上架'
            : '已取消寄卖，商品下架';
      toast(msg);
      onDone();
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={
        decision === 'ACCEPT'
          ? `接受追加翻新预算 · ${row.itemTitle}`
          : decision === 'REDUCE_LIST'
            ? `拒绝追加 · 降价上架 · ${row.itemTitle}`
            : `拒绝追加 · 取消寄卖 · ${row.itemTitle}`
      }
      onClose={onClose}
      footer={
        <>
          <button className="btn gray" onClick={onClose}>再想想</button>
          <button
            className={decision === 'CANCEL_CONSIGNMENT' ? 'btn danger' : 'btn'}
            disabled={busy}
            onClick={() => {
              if (decision === 'CANCEL_CONSIGNMENT' && !confirm('确认取消该件家具的寄卖？商品将下架终止寄卖。')) return;
              submit();
            }}
          >
            {decision === 'ACCEPT' ? '确认接受' : decision === 'REDUCE_LIST' ? '确认降价上架' : '确认取消寄卖'}
          </button>
        </>
      }
    >
      {decision === 'ACCEPT' && (
        <>
          <div className="banner info">
            接受后仓库按方案继续翻新（整体重新打磨上漆等），追加预算
            <Money v={row.extraTotal} /> 将与已发生翻新费一并
            <b>从成交款中扣除</b>；翻新完成后仓库会<b>重新拍摄并更新瑕疵说明</b>，
            买家看到的是翻新后的真实状态。
            {row.listingImpact === 'DELAY' && <>预计上架时间推迟约 <b>{row.delayDays}</b> 天。</>}
          </div>
          <dl className="kv">
            <dt>新增工时费</dt><dd><Money v={row.extraLaborCost} /></dd>
            <dt>新增材料费</dt><dd><Money v={row.extraMaterialCost} /></dd>
            <dt>追加合计</dt><dd className="price"><Money v={row.extraTotal} /></dd>
          </dl>
        </>
      )}
      {decision === 'REDUCE_LIST' && (
        <>
          <div className="banner warn">
            不做追加翻新，商品按现状（仍有较明显划痕）<b>降价上架</b>。
            仓库会重新拍摄并如实更新瑕疵说明，买家将按现状购买。
          </div>
          <Field label={`降价后挂牌价（须低于当前价 ¥${row.currentListedPrice}）`}>
            <input type="number" value={reducedPrice} onChange={(e) => setReducedPrice(+e.target.value)} />
          </Field>
        </>
      )}
      {decision === 'CANCEL_CONSIGNMENT' && (
        <div className="banner risk">
          取消寄卖后商品下架、寄卖终止。已发生的清洁翻新费用按平台规则处理，
          该操作区别于卖家主动反悔，<b>不会计入你的卖家信用画像</b>。
        </div>
      )}
      <Field label="给平台的留言（可选）">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  );
}

/**
 * 寄卖详情内嵌的超预算面板（卖家/内部角色复用）。
 * 传 itemId：自动取该商品最近一张确认单。
 */
export function OverrunPanel({
  itemId,
  viewerRole,
  onChanged,
}: {
  itemId: string;
  viewerRole: string;
  onChanged?: () => void;
}) {
  const [list, setList] = useState<any[] | null>(null);
  const [decideFor, setDecideFor] = useState<any>(null);
  const [detailFor, setDetailFor] = useState<any>(null);
  const load = () => {
    api('/refurbish-overruns').then(setList).catch(() => setList([]));
  };
  useEffect(() => {
    load();
  }, [itemId]);

  if (!list) return null;
  const mine = list
    .filter((r) => r.itemId === itemId)
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  if (mine.length === 0) return null;
  const latest = mine[0];
  const isSeller = viewerRole === 'SELLER';

  return (
    <div className="card" style={{ marginTop: 14, borderColor: '#fca5a5' }}>
      <h3>
        翻新成本超预算确认
        <span style={{ marginLeft: 8 }}><Badge map={OVERRUN_STATUS} value={latest.status} /></span>
      </h3>
      <div className={latest.status === 'PENDING_SELLER' ? 'banner risk' : 'banner info'}>
        {latest.reason}
      </div>
      <dl className="kv" style={{ marginTop: 8 }}>
        <dt>单号</dt><dd>{latest.code}</dd>
        <dt>估价预算 → 追加</dt>
        <dd><Money v={latest.budgetedRefurbishCost} /> → <b><Money v={latest.extraTotal} /></b>
          （工时 <Money v={latest.extraLaborCost} /> + 材料 <Money v={latest.extraMaterialCost} />）</dd>
        <dt>售价/上架影响</dt>
        <dd>建议价 <Money v={latest.suggestedPrice} />（原 <Money v={latest.currentListedPrice} />）；
          {latest.listingImpact === 'DELAY' ? `预计推迟 ${latest.delayDays} 天上架` : '不影响上架时间'}</dd>
        {latest.reducedPrice && <><dt>降价后挂牌</dt><dd><Money v={latest.reducedPrice} /></dd></>}
        {latest.sellerNote && <><dt>卖家留言</dt><dd>{latest.sellerNote}</dd></>}
        {latest.photoCompletedAt && (
          <><dt>翻新后重拍</dt><dd>{new Date(latest.photoCompletedAt).toLocaleString()} 已完成，旧照片归档内部审计</dd></>
        )}
      </dl>
      {isSeller && latest.status === 'PENDING_SELLER' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button className="btn" onClick={() => setDecideFor({ row: latest, decision: 'ACCEPT' })}>接受（成交款扣除）</button>
          <button className="btn ghost" onClick={() => setDecideFor({ row: latest, decision: 'REDUCE_LIST' })}>拒绝·降价上架</button>
          <button className="btn danger" onClick={() => setDecideFor({ row: latest, decision: 'CANCEL_CONSIGNMENT' })}>拒绝·取消寄卖</button>
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        <button className="btn gray sm" onClick={() => setDetailFor(latest)}>查看完整单据与作业</button>
      </div>
      {decideFor && (
        <DecideModal
          data={decideFor}
          onClose={() => setDecideFor(null)}
          onDone={() => { setDecideFor(null); load(); onChanged?.(); }}
        />
      )}
      {detailFor && <OverrunDetailModal id={detailFor.id} onClose={() => setDetailFor(null)} />}
    </div>
  );
}

export function OverrunDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [d, setD] = useState<any>(null);
  useEffect(() => {
    api(`/refurbish-overruns/${id}`).then(setD).catch(() => {});
  }, [id]);
  if (!d) return null;
  const { overrun: o, item, appraisal, appraiserName, workLogs } = d;
  return (
    <Modal
      wide
      title={`超预算确认单 ${o.code}`}
      onClose={onClose}
      footer={<button className="btn" onClick={onClose}>关闭</button>}
    >
      <div style={{ marginBottom: 10 }}>
        <Badge map={OVERRUN_STATUS} value={o.status} />{' '}
        <Badge map={DEVIATION_CATEGORY} value={o.deviationCategory} />
        {item && <span style={{ marginLeft: 8 }}><Badge map={ITEM_STATUS} value={item.status} /></span>}
      </div>
      <dl className="kv">
        <dt>商品</dt><dd>{item?.title}</dd>
        <dt>估价师</dt><dd>{appraiserName}（估价偏差归因用于平台内部考核）</dd>
        <dt>估价翻新预算</dt><dd><Money v={o.budgetedRefurbishCost} /></dd>
        <dt>发起前已发生</dt><dd><Money v={o.incurredRefurbishCost} /></dd>
        <dt>新增工时/材料</dt><dd><Money v={o.extraLaborCost} /> / <Money v={o.extraMaterialCost} /></dd>
        <dt>追加合计</dt><dd className="price"><Money v={o.extraTotal} /></dd>
        <dt>实际追加作业</dt><dd><Money v={o.extraSpentCost} /></dd>
        <dt>售价影响</dt><dd>建议 <Money v={o.suggestedPrice} />（原 <Money v={o.currentListedPrice} />）{o.priceImpactNote ? `；${o.priceImpactNote}` : ''}</dd>
        <dt>上架影响</dt><dd>{o.listingImpact === 'DELAY' ? `推迟约 ${o.delayDays} 天` : '不影响'}</dd>
        <dt>问题说明</dt><dd>{o.reason}</dd>
        {o.reducedPrice && <><dt>降价后价格</dt><dd><Money v={o.reducedPrice} /></dd></>}
        {o.sellerNote && <><dt>卖家留言</dt><dd>{o.sellerNote}</dd></>}
        {o.photoCompletedAt && (
          <>
            <dt>翻新后重拍</dt>
            <dd>{new Date(o.photoCompletedAt).toLocaleString()} 已重新拍摄并更新瑕疵说明，旧照片归档内部审计</dd>
          </>
        )}
      </dl>
      {workLogs?.length > 0 && (
        <>
          <div className="section-title">作业记录</div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>作业</th><th>说明</th><th>费用</th><th>时间</th></tr></thead>
              <tbody>
                {workLogs.map((l: any) => (
                  <tr key={l.id}>
                    <td>{l.type}</td>
                    <td>{l.note || '-'}</td>
                    <td><Money v={l.cost} /></td>
                    <td className="muted">{new Date(l.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {appraisal && (
        <div className="hint" style={{ marginTop: 8 }}>
          估价单翻新预算 <Money v={appraisal.estimatedRefurbishCost} />，清洁建议：{appraisal.cleaningAdvice || '-'}
        </div>
      )}
    </Modal>
  );
}
