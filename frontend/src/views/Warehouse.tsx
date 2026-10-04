import { useEffect, useState } from 'react';
import { api, AuthUser } from '../api';
import {
  Badge, Modal, Field, Money, Empty, toast,
} from '../ui';
import { CATEGORY, ITEM_STATUS, WORK_LOG_TYPE, OVERRUN_STATUS, DEVIATION_CATEGORY } from '../labels';
import { ConsignmentDetail } from './ConsignmentDetail';

const FILTERS = ['PREPARING', 'OVERRUN_PENDING', 'PHOTOGRAPHY', 'LISTED', 'RESERVED', 'RETURNED'] as const;

export function WarehouseView({ user }: { user: AuthUser }) {
  const [mode, setMode] = useState<'items' | 'overruns'>('items');
  const [items, setItems] = useState<any[]>([]);
  const [filter, setFilter] = useState<string>('PREPARING');
  const [workFor, setWorkFor] = useState<any>(null);
  const [advanceFor, setAdvanceFor] = useState<any>(null);
  const [overrunCreateFor, setOverrunCreateFor] = useState<any>(null);
  const [overrunViewFor, setOverrunViewFor] = useState<any>(null);
  const [detailConsignment, setDetailConsignment] = useState<string | null>(null);

  const load = () => {
    api(`/items?status=${filter}`).then(setItems);
  };
  useEffect(() => {
    load();
  }, [filter]);

  if (detailConsignment) {
    return <ConsignmentDetail id={detailConsignment} onBack={() => setDetailConsignment(null)} viewerRole={user.role} />;
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>清洁翻新 · 入库上架</h2>
          <div className="sub">
            {user.role === 'REFURBISHER'
              ? '登记清洁、补漆、维修作业，费用自动累计并进入结算来源；发现估价时未预见的损伤可发起超预算确认'
              : '管理库位、拍照与上架描述；翻新方案变更后须重新拍摄，买家只看翻新后的真实状态'}
          </div>
        </div>
      </div>
      <div className="pill-filter">
        <button className={mode === 'items' ? 'active' : ''} onClick={() => setMode('items')}>商品作业</button>
        <button className={mode === 'overruns' ? 'active' : ''} onClick={() => setMode('overruns')}>翻新超预算确认单</button>
      </div>
      {mode === 'overruns' ? (
        <InternalOverrunList role={user.role} onOpenItem={(it) => { setMode('items'); setOverrunViewFor(it); }} />
      ) : (
      <>
      <div className="pill-filter">
        {FILTERS.map((s) => (
          <button key={s} className={filter === s ? 'active' : ''} onClick={() => setFilter(s)}>
            {ITEM_STATUS[s].label}
          </button>
        ))}
      </div>
      {items.length === 0 ? (
        <Empty text="该状态下暂无商品" />
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>商品</th><th>品类</th><th>状态</th><th>位置/库位</th>
                  <th>清洁费</th><th>翻新费</th><th>配送范围</th><th>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td>
                      <a onClick={() => setDetailConsignment(it.consignmentId)} style={{ cursor: 'pointer' }}>
                        {it.title}
                      </a>
                    </td>
                    <td>{CATEGORY[it.category]}</td>
                    <td><Badge map={ITEM_STATUS} value={it.status} /></td>
                    <td>
                      {it.location === 'WAREHOUSE' ? '在仓' : '卖家家中'}
                      {it.warehouseSlot && <span className="tag">{it.warehouseSlot}</span>}
                    </td>
                    <td><Money v={it.cleaningCost} /></td>
                    <td>
                      <Money v={it.refurbishCost} />
                      {Number(it.approvedOverrunCost) > 0 && (
                        <div className="hint">含卖家确认追加 <Money v={it.approvedOverrunCost} /></div>
                      )}
                    </td>
                    <td>{String(it.deliveryRadiusKm) === '0' ? '仅自提' : `${it.deliveryRadiusKm}km`}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {it.status === 'OVERRUN_PENDING' && (
                        <button className="btn danger sm" onClick={() => setOverrunViewFor(it)}>超预算待确认</button>
                      )}
                      {['PREPARING', 'PHOTOGRAPHY'].includes(it.status) && (
                        <button className="btn ghost sm" style={{ marginRight: 4 }} onClick={() => setWorkFor(it)}>登记作业</button>
                      )}
                      {it.status === 'PREPARING' && (
                        <>
                          <button className="btn ghost sm" style={{ marginRight: 4 }} onClick={() => setOverrunCreateFor(it)}>发起超预算确认</button>
                          <button className="btn sm" onClick={() => setAdvanceFor(it)}>清洁完成→拍照</button>
                        </>
                      )}
                      {it.status === 'PHOTOGRAPHY' && (
                        <button className="btn sm" onClick={() => setAdvanceFor(it)}>完善信息→上架</button>
                      )}
                      {it.status === 'RETURNED' && (
                        <button className="btn sm" onClick={() => setAdvanceFor(it)}>返仓复检→重新上架</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </>
      )}
      {workFor && <WorkLogModal item={workFor} onClose={() => setWorkFor(null)} onDone={() => { setWorkFor(null); load(); }} role={user.role} />}
      {advanceFor && (
        <AdvanceModal
          item={advanceFor}
          onClose={() => setAdvanceFor(null)}
          onDone={() => { setAdvanceFor(null); load(); }}
        />
      )}
      {overrunCreateFor && (
        <CreateOverrunModal
          item={overrunCreateFor}
          onClose={() => setOverrunCreateFor(null)}
          onDone={() => { setOverrunCreateFor(null); load(); }}
        />
      )}
      {overrunViewFor && (
        <ViewOverrunModal
          item={overrunViewFor}
          onClose={() => setOverrunViewFor(null)}
          onChanged={() => { setOverrunViewFor(null); load(); }}
        />
      )}
    </div>
  );
}

function WorkLogModal({ item, onClose, onDone, role }: { item: any; onClose: () => void; onDone: () => void; role: string }) {
  const refurbisher = role === 'REFURBISHER';
  const [f, setF] = useState({
    type: refurbisher ? 'CLEANING' : 'STORAGE',
    note: '',
    cost: 0,
  });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api(`/items/${item.id}/work-logs`, { body: f });
      toast('作业已登记');
      onDone();
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`登记作业 · ${item.title}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn gray" onClick={onClose}>取消</button>
          <button className="btn" disabled={busy} onClick={submit}>保存</button>
        </>
      }
    >
      <Field label="作业类型">
        <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
          {Object.entries(WORK_LOG_TYPE)
            .filter(([k]) => role === 'REFURBISHER'
              ? ['CLEANING', 'REPAINT', 'REPAIR'].includes(k)
              : ['STORAGE', 'PHOTOGRAPHY', 'LISTING_COPY', 'CLEANING'].includes(k))
            .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label={f.type === 'STORAGE' ? '库位编号（如 A-03-12）' : '作业说明'}>
        <input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </Field>
      {f.type !== 'STORAGE' && (
        <Field label="费用（元，将计入结算）">
          <input type="number" min={0} value={f.cost} onChange={(e) => setF({ ...f, cost: +e.target.value })} />
        </Field>
      )}
    </Modal>
  );
}

function AdvanceModal({ item, onClose, onDone }: { item: any; onClose: () => void; onDone: () => void }) {
  const isPreparing = item.status === 'PREPARING';
  const [detail, setDetail] = useState<any>(null);
  const [f, setF] = useState({
    description: item.description || '',
    photos: (item.photos || []).join(','),
    defectNote: '',
    warehouseSlot: item.warehouseSlot || '',
    deliveryRadiusKm: item.deliveryRadiusKm,
    listedPrice: Number(item.listedPrice),
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isPreparing) {
      api(`/items/${item.id}`).then((d) => {
        setDetail(d);
        setF((p) => ({
          ...p,
          description: d.item?.description || p.description,
          photos: (d.item?.photos || []).join(','),
          defectNote: d.item?.defectNote || '',
          listedPrice: Number(d.item?.listedPrice || p.listedPrice),
        }));
      }).catch(() => {});
    }
  }, []);

  // 发生过翻新超预算：上架前必须翻新后重新拍摄并更新瑕疵说明
  const overrun = detail?.overrun;
  const needRephotos =
    !!overrun &&
    ['ACCEPTED', 'REJECTED_REDUCE'].includes(overrun.status) &&
    !overrun.photoCompletedAt;

  const submit = async () => {
    setBusy(true);
    try {
      if (isPreparing) {
        await api(`/items/${item.id}/advance`, { body: { to: 'PHOTOGRAPHY' } });
        toast('已进入拍照环节');
      } else {
        if (needRephotos) {
          const photos = f.photos ? f.photos.split(/[,，\s]+/).filter(Boolean) : [];
          await api(`/refurbish-overruns/${overrun.id}/rephotos`, {
            body: { photos, defectNote: f.defectNote },
          });
          toast('翻新后照片与瑕疵说明已更新，旧照片已归档内部审计');
        }
        await api(`/items/${item.id}/advance`, {
          body: {
            to: 'LISTED',
            description: f.description,
            // 有超预算单时照片只能由重拍接口更新，普通上架不带 photos
            photos: needRephotos ? undefined : (f.photos ? f.photos.split(/[,，\s]+/).filter(Boolean) : []),
            warehouseSlot: f.warehouseSlot,
            deliveryRadiusKm: Number(f.deliveryRadiusKm),
            listedPrice: Number(f.listedPrice),
          },
        });
        toast('商品已上架');
      }
      onDone();
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  if (isPreparing) {
    return (
      <Modal
        title="确认清洁翻新完成"
        onClose={onClose}
        footer={
          <>
            <button className="btn gray" onClick={onClose}>取消</button>
            <button className="btn" disabled={busy} onClick={submit}>进入拍照环节</button>
          </>
        }
      >
        <div className="banner info">
          已累计清洁费 <Money v={item.cleaningCost} />、翻新费 <Money v={item.refurbishCost} />。
          若清洁中发现估价时未预见的损伤、翻新成本明显超出估价师预估，请先
          <b>「发起超预算确认」</b>推给卖家，不要直接进入下一环节。
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      wide
      title={item.status === 'RETURNED' ? '退货返仓 · 复检后重新上架' : '完善拍照与上架描述'}
      onClose={onClose}
      footer={
        <>
          <button className="btn gray" onClick={onClose}>取消</button>
          <button className="btn" disabled={busy} onClick={submit}>
            {needRephotos ? '确认重拍并上架' : '确认上架'}
          </button>
        </>
      }
    >
      {needRephotos && (
        <div className="banner warn">
          该商品翻新方案经卖家重新确认（{OVERRUN_STATUS[overrun.status]?.label}）。
          翻新完成后<b>必须重新拍摄</b>并更新瑕疵说明：买家只会看到翻新后的照片与真实状态，
          翻新前旧照片（含卖家瑕疵照、发现损伤照）将仅保留在内部审计记录中。
        </div>
      )}
      <div className="row2">
        <Field label="库位编号">
          <input value={f.warehouseSlot} onChange={(e) => setF({ ...f, warehouseSlot: e.target.value })} />
        </Field>
        <Field label="可配送范围（公里，0=仅同城自提）">
          <input type="number" min={0} value={f.deliveryRadiusKm} onChange={(e) => setF({ ...f, deliveryRadiusKm: +e.target.value })} />
        </Field>
        <Field label="挂牌价（元）">
          <input type="number" value={f.listedPrice} onChange={(e) => setF({ ...f, listedPrice: +e.target.value })} />
        </Field>
        <Field label={needRephotos ? '翻新后照片链接（逗号分隔，买家可见）' : '照片链接（逗号分隔）'}>
          <input value={f.photos} onChange={(e) => setF({ ...f, photos: e.target.value })} />
        </Field>
      </div>
      {needRephotos && (
        <Field label="翻新后瑕疵说明（买家可见，须如实描述残留瑕疵）">
          <textarea
            style={{ minHeight: 90 }}
            value={f.defectNote}
            onChange={(e) => setF({ ...f, defectNote: e.target.value })}
            placeholder="如：顶面右侧曾有划痕，已整体打磨上漆，侧光下仍可见轻微痕迹，不影响使用"
          />
        </Field>
      )}
      <Field label="上架描述（成色、尺寸、通道/电梯适配提示等）">
        <textarea style={{ minHeight: 110 }} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })}
          placeholder="建议写明：实际成色、已完成的清洁翻新、最小通道/电梯尺寸要求、是否可拆装" />
      </Field>
    </Modal>
  );
}

/** 仓库/翻新师发起翻新超预算确认 */
function CreateOverrunModal({ item, onClose, onDone }: { item: any; onClose: () => void; onDone: () => void }) {
  const [detail, setDetail] = useState<any>(null);
  const [f, setF] = useState({
    reason: '',
    discoveryPhotos: '',
    extraLaborCost: 0,
    extraMaterialCost: 0,
    suggestedPrice: Number(item.listedPrice),
    priceImpactNote: '',
    delayDays: 0,
    listingImpact: 'NO_DELAY' as 'DELAY' | 'NO_DELAY',
    deviationCategory: 'UNFORESEEABLE',
    deviationNote: '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    api(`/items/${item.id}`).then(setDetail).catch(() => {});
  }, []);

  const appraisal = detail?.appraisal;
  const budget = Number(appraisal?.estimatedRefurbishCost || 0);
  const incurred = Number(item.cleaningCost || 0) + Number(item.refurbishCost || 0);
  const extraTotal = Number(f.extraLaborCost || 0) + Number(f.extraMaterialCost || 0);

  const submit = async () => {
    if (!f.reason.trim()) return toast('请说明发现的新问题', true);
    if (extraTotal <= 0) return toast('请填写新增工时费与材料费', true);
    setBusy(true);
    try {
      await api(`/refurbish-overruns/item/${item.id}`, {
        body: {
          ...f,
          discoveryPhotos: f.discoveryPhotos ? f.discoveryPhotos.split(/[,，\s]+/).filter(Boolean) : [],
        },
      });
      toast('已推送给卖家确认，翻新作业暂停等待回复');
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
      title={`发起翻新超预算确认 · ${item.title}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn gray" onClick={onClose}>取消</button>
          <button className="btn danger" disabled={busy} onClick={submit}>推送卖家确认</button>
        </>
      }
    >
      <div className="banner warn">
        估价时预估翻新成本 <Money v={budget} />，目前已发生清洁+翻新 <Money v={incurred} />。
        发起后商品进入<b>「超预算待卖家确认」</b>，暂停翻新作业；卖家接受后追加费用从成交款扣除。
      </div>
      <Field label="发现的问题（如：清洁时发现桌面划痕比估价时严重，需整体重新打磨上漆）">
        <textarea style={{ minHeight: 90 }} value={f.reason} onChange={(e) => set('reason', e.target.value)} />
      </Field>
      <Field label="发现损伤时的照片链接（内部留档，不对买家展示）">
        <input value={f.discoveryPhotos} onChange={(e) => set('discoveryPhotos', e.target.value)} placeholder="多个用逗号分隔" />
      </Field>
      <div className="row2">
        <Field label="新增工时费（元）">
          <input type="number" min={0} value={f.extraLaborCost} onChange={(e) => set('extraLaborCost', +e.target.value)} />
        </Field>
        <Field label="新增材料费（元）">
          <input type="number" min={0} value={f.extraMaterialCost} onChange={(e) => set('extraMaterialCost', +e.target.value)} />
        </Field>
        <Field label="追加预算合计（元）">
          <div className="price" style={{ paddingTop: 6 }}><Money v={extraTotal} /></div>
        </Field>
        <Field label="翻新后建议售价（元）">
          <input type="number" min={0} value={f.suggestedPrice} onChange={(e) => set('suggestedPrice', +e.target.value)} />
        </Field>
        <Field label="预计上架时间影响">
          <select
            value={f.listingImpact}
            onChange={(e) => set('listingImpact', e.target.value as 'DELAY' | 'NO_DELAY')}
          >
            <option value="NO_DELAY">不影响上架时间</option>
            <option value="DELAY">将推迟上架</option>
          </select>
        </Field>
        {f.listingImpact === 'DELAY' && (
          <Field label="预计推迟天数">
            <input type="number" min={1} value={f.delayDays || 1} onChange={(e) => set('delayDays', +e.target.value)} />
          </Field>
        )}
      </div>
      <Field label="预计售价变化说明">
        <textarea value={f.priceImpactNote} onChange={(e) => set('priceImpactNote', e.target.value)}
          placeholder="如：整体打磨上漆后成色提升可维持原价；急于出手可降价约 3%" />
      </Field>
      <div className="row2">
        <Field label="估价偏差初步归因（平台保留用于考核估价师，运营可复核调整）">
          <select value={f.deviationCategory} onChange={(e) => set('deviationCategory', e.target.value)}>
            {Object.entries(DEVIATION_CATEGORY).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </Field>
        <Field label="偏差原因说明">
          <input value={f.deviationNote} onChange={(e) => set('deviationNote', e.target.value)}
            placeholder="如：卖家强光下拍照掩盖深层划痕 / 估价师未斜光复检" />
        </Field>
      </div>
    </Modal>
  );
}

/** 查看商品当前待确认/最近的超预算单 */
function ViewOverrunModal({ item, onClose, onChanged }: { item: any; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<any>(null);
  useEffect(() => {
    api(`/items/${item.id}`).then(setDetail).catch(() => {});
  }, []);
  const o = detail?.overrun;
  return (
    <Modal
      title={`翻新超预算确认 · ${item.title}`}
      onClose={onClose}
      footer={<button className="btn" onClick={onClose}>关闭</button>}
    >
      {!o ? <Empty text="未找到超预算确认单" /> : (
        <div>
          <div className="banner risk">
            当前状态：<Badge map={OVERRUN_STATUS} value={o.status} />
            ，翻新作业已暂停，等待卖家在「我的寄卖」中确认。
          </div>
          <dl className="kv">
            <dt>单号</dt><dd>{o.code}</dd>
            <dt>追加预算</dt><dd><Money v={o.extraTotal} />（工时 <Money v={o.extraLaborCost} /> + 材料 <Money v={o.extraMaterialCost} />）</dd>
            <dt>估价预算</dt><dd><Money v={o.budgetedRefurbishCost} /></dd>
            <dt>建议售价</dt><dd><Money v={o.suggestedPrice} /></dd>
            <dt>上架影响</dt><dd>{o.listingImpact === 'DELAY' ? `推迟约 ${o.delayDays} 天` : '不影响'}</dd>
            <dt>偏差归因</dt><dd><Badge map={DEVIATION_CATEGORY} value={o.deviationCategory} /></dd>
            <dt>问题说明</dt><dd>{o.reason}</dd>
            <dt>发现照片</dt>
            <dd>{o.discoveryPhotos?.length ? o.discoveryPhotos.map((p: string, i: number) => (
              <a key={i} href={p} target="_blank" rel="noreferrer" className="tag">发现照{i + 1}</a>
            )) : '无'}</dd>
          </dl>
        </div>
      )}
    </Modal>
  );
}

/** 内部视角：翻新超预算确认单列表 + 翻新后重拍入口 */
function InternalOverrunList({ role, onOpenItem }: { role: string; onOpenItem: (item: any) => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [filter, setFilter] = useState('ALL');
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = () => {
    api('/refurbish-overruns').then(setRows);
  };
  useEffect(load, []);

  const shown = rows.filter((r) => (filter === 'ALL' ? true : r.status === filter));

  const reopen = async (itemId: string) => {
    const items: any[] = await api('/items');
    const it = items.find((x) => x.id === itemId);
    if (it) onOpenItem(it);
  };

  return (
    <>
      <div className="pill-filter">
        {[
          ['ALL', '全部'],
          ['PENDING_SELLER', '待卖家确认'],
          ['ACCEPTED', '卖家已接受'],
          ['REJECTED_REDUCE', '降价上架'],
          ['REJECTED_CANCEL', '取消寄卖'],
        ].map(([k, v]) => (
          <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>{v}</button>
        ))}
      </div>
      {shown.length === 0 ? (
        <Empty text="暂无超预算确认单" />
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>单号</th><th>商品</th><th>估价预算</th><th>追加预算</th><th>建议售价</th>
                  <th>上架影响</th><th>状态</th><th>重拍</th><th></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td>{r.code}</td>
                    <td>{r.itemTitle}</td>
                    <td><Money v={r.budgetedRefurbishCost} /></td>
                    <td><Money v={r.extraTotal} /></td>
                    <td><Money v={r.suggestedPrice} /></td>
                    <td>{r.listingImpact === 'DELAY' ? `推迟 ${r.delayDays} 天` : '不影响'}</td>
                    <td><Badge map={OVERRUN_STATUS} value={r.status} /></td>
                    <td>
                      {['ACCEPTED', 'REJECTED_REDUCE'].includes(r.status)
                        ? (r.photoCompletedAt
                            ? <span className="badge green">已重拍</span>
                            : <span className="badge amber">待重拍</span>)
                        : '-'}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn sm" style={{ marginRight: 4 }} onClick={() => setDetailId(r.id)}>处理/详情</button>
                      <button className="btn ghost sm" onClick={() => reopen(r.itemId)}>商品</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {detailId && (
        <InternalOverrunDetail
          id={detailId}
          role={role}
          onClose={() => { setDetailId(null); load(); }}
        />
      )}
    </>
  );
}

function InternalOverrunDetail({ id, role, onClose }: { id: string; role: string; onClose: () => void }) {
  const [d, setD] = useState<any>(null);
  const [rephotos, setRephotos] = useState(false);
  const [photos, setPhotos] = useState('');
  const [defectNote, setDefectNote] = useState('');
  const [review, setReview] = useState(false);
  const [devCategory, setDevCategory] = useState('UNFORESEEABLE');
  const [devNote, setDevNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api(`/refurbish-overruns/${id}`).then(setD);
  useEffect(() => { load(); }, [id]);

  const submitReview = async () => {
    setBusy(true);
    try {
      await api(`/refurbish-overruns/${id}/deviation`, {
        body: { deviationCategory: devCategory, deviationNote: devNote },
      });
      toast('估价偏差归因已复核更新');
      setReview(false);
      load();
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  if (!d) return <Modal title="加载中…" onClose={onClose}><Empty text="加载中…" /></Modal>;
  const o = d.overrun;
  const item = d.item;
  const canReview = role === 'OPS' || role === 'ADMIN';
  const canRephotos =
    ['ACCEPTED', 'REJECTED_REDUCE'].includes(o.status) &&
    item?.status === 'PHOTOGRAPHY' &&
    !o.photoCompletedAt;

  const submitRephotos = async () => {
    const list = photos ? photos.split(/[,，\s]+/).filter(Boolean) : [];
    if (!list.length) return toast('请填写翻新后照片链接', true);
    if (!defectNote.trim()) return toast('请填写翻新后瑕疵说明', true);
    setBusy(true);
    try {
      await api(`/refurbish-overruns/${id}/rephotos`, { body: { photos: list, defectNote } });
      toast('翻新后照片与瑕疵说明已更新，旧照片已归档内部审计');
      setRephotos(false);
      load();
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      wide
      title={`超预算确认单 ${o.code}`}
      onClose={onClose}
      footer={
        <>
          {canRephotos && !rephotos && (
            <button className="btn" onClick={() => setRephotos(true)}>翻新完成·重新拍摄并更新瑕疵说明</button>
          )}
          <button className="btn gray" onClick={onClose}>关闭</button>
        </>
      }
    >
      <div style={{ marginBottom: 10 }}>
        <Badge map={OVERRUN_STATUS} value={o.status} />{' '}
        <Badge map={DEVIATION_CATEGORY} value={o.deviationCategory} />
        {item && <span style={{ marginLeft: 8 }}><Badge map={ITEM_STATUS} value={item.status} /></span>}
      </div>
      <div className="banner info">
        估价偏差归因保留用于考核估价师：{d.appraiserName}（{o.deviationNote || '待运营复核补充'}）
        {canReview && (
          <button className="btn ghost sm" style={{ marginLeft: 10 }}
            onClick={() => { setDevCategory(o.deviationCategory); setDevNote(o.deviationNote || ''); setReview(!review); }}>
            {review ? '取消复核' : '运营复核归因'}
          </button>
        )}
      </div>
      {review && canReview && (
        <div className="card" style={{ background: '#f8fafc', marginBottom: 10 }}>
          <Field label="偏差归因（现场低估纳入估价师考核）">
            <select value={devCategory} onChange={(e) => setDevCategory(e.target.value)}>
              {Object.entries(DEVIATION_CATEGORY).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </Field>
          <Field label="偏差原因说明">
            <textarea style={{ minHeight: 70 }} value={devNote} onChange={(e) => setDevNote(e.target.value)} />
          </Field>
          <button className="btn sm" disabled={busy} onClick={submitReview}>保存归因</button>
        </div>
      )}
      <dl className="kv">
        <dt>商品</dt><dd>{item?.title}（库位 {item?.warehouseSlot || '-'}）</dd>
        <dt>问题说明</dt><dd>{o.reason}</dd>
        <dt>估价预算</dt><dd><Money v={o.budgetedRefurbishCost} />；发起前已发生 <Money v={o.incurredRefurbishCost} /></dd>
        <dt>新增工时/材料</dt><dd><Money v={o.extraLaborCost} /> / <Money v={o.extraMaterialCost} /></dd>
        <dt>追加合计</dt><dd className="price"><Money v={o.extraTotal} />；已实际占用 <Money v={o.extraSpentCost} /></dd>
        <dt>售价影响</dt><dd>建议 <Money v={o.suggestedPrice} />（原 <Money v={o.currentListedPrice} />）{o.priceImpactNote ? `；${o.priceImpactNote}` : ''}</dd>
        <dt>上架影响</dt><dd>{o.listingImpact === 'DELAY' ? `预计推迟 ${o.delayDays} 天` : '不影响'}</dd>
        {o.reducedPrice && <><dt>降价后价格</dt><dd><Money v={o.reducedPrice} /></dd></>}
        {o.sellerNote && <><dt>卖家留言</dt><dd>{o.sellerNote}</dd></>}
        {o.sellerDecidedAt && <><dt>卖家决定时间</dt><dd>{new Date(o.sellerDecidedAt).toLocaleString()}</dd></>}
        {o.photoCompletedAt && <><dt>重拍完成</dt><dd>{new Date(o.photoCompletedAt).toLocaleString()}</dd></>}
        <dt>发现照片（内部）</dt>
        <dd>{o.discoveryPhotos?.length ? o.discoveryPhotos.map((p: string, i: number) => (
          <a key={i} href={p} target="_blank" rel="noreferrer" className="tag">发现照{i + 1}</a>
        )) : '无'}</dd>
        <dt>内部审计旧照</dt>
        <dd>{item?.archivedInternalPhotos?.length ? item.archivedInternalPhotos.map((p: string, i: number) => (
          <a key={i} href={p} target="_blank" rel="noreferrer" className="tag">旧照{i + 1}</a>
        )) : '暂无'}</dd>
        <dt>当前对外照片</dt>
        <dd>{item?.photos?.length ? item.photos.map((p: string, i: number) => (
          <a key={i} href={p} target="_blank" rel="noreferrer" className="tag">新照{i + 1}</a>
        )) : '暂无（翻新后重拍）'}</dd>
        <dt>翻新后瑕疵说明</dt><dd>{item?.defectNote || '待重拍时填写'}</dd>
      </dl>

      {rephotos && (
        <div className="card" style={{ background: '#f8fafc' }}>
          <Field label="翻新后照片链接（逗号分隔；买家可见，旧照片将归档内部审计）">
            <input value={photos} onChange={(e) => setPhotos(e.target.value)} />
          </Field>
          <Field label="翻新后瑕疵说明（买家可见的真实状态）">
            <textarea style={{ minHeight: 90 }} value={defectNote} onChange={(e) => setDefectNote(e.target.value)} />
          </Field>
          <button className="btn" disabled={busy} onClick={submitRephotos}>确认重拍归档</button>
        </div>
      )}
    </Modal>
  );
}
