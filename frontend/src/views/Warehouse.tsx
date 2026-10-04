import { useEffect, useState } from 'react';
import { api, AuthUser } from '../api';
import {
  Badge, Modal, Field, Money, Empty, toast,
} from '../ui';
import { CATEGORY, ITEM_STATUS, WORK_LOG_TYPE, OVERRUN_STATUS } from '../labels';
import { ConsignmentDetail } from './ConsignmentDetail';

const FILTERS = ['PREPARING', 'PHOTOGRAPHY', 'LISTED', 'RESERVED', 'RETURNED'] as const;

export function WarehouseView({ user }: { user: AuthUser }) {
  const [items, setItems] = useState<any[]>([]);
  const [filter, setFilter] = useState<string>('PREPARING');
  const [workFor, setWorkFor] = useState<any>(null);
  const [advanceFor, setAdvanceFor] = useState<any>(null);
  const [overrunFor, setOverrunFor] = useState<any>(null);
  const [rephotoFor, setRephotoFor] = useState<any>(null);
  const [detailConsignment, setDetailConsignment] = useState<string | null>(null);
  const [overrunMap, setOverrunMap] = useState<Record<string, any>>({});
  const [tab, setTab] = useState<'items' | 'overruns'>('items');

  const load = () => {
    api(`/items?status=${filter}`).then(setItems);
    api('/refurbish/overruns').then((rows: any[]) => {
      const map: Record<string, any> = {};
      rows.forEach((r) => {
        if (!map[r.itemId] || r.status === 'PENDING') map[r.itemId] = r;
      });
      setOverrunMap(map);
    }).catch(() => {});
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
              ? '登记清洁、补漆、维修作业；发现瑕疵比估价严重可发起超预算确认，费用经卖家确认后进入结算'
              : '管理库位、翻新后重拍与瑕疵说明；旧照片仅内部审计留存，买家只见翻新后真实状态'}
          </div>
        </div>
        <div className="pill-filter" style={{ margin: 0 }}>
          <button className={tab === 'items' ? 'active' : ''} onClick={() => setTab('items')}>商品作业</button>
          <button className={tab === 'overruns' ? 'active' : ''} onClick={() => setTab('overruns')}>
            超预算确认
            {Object.values(overrunMap).filter((o: any) => o.status === 'PENDING').length > 0 && (
              <span className="badge amber" style={{ marginLeft: 6 }}>
                {Object.values(overrunMap).filter((o: any) => o.status === 'PENDING').length}
              </span>
            )}
          </button>
        </div>
      </div>

      {tab === 'overruns' ? (
        <OverrunPanel user={user} onChanged={load} />
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
                      <th>商品</th><th>品类</th><th>状态</th><th>超预算确认</th><th>位置/库位</th>
                      <th>清洁费</th><th>翻新费</th><th>配送范围</th><th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => {
                      const ov = overrunMap[it.id];
                      return (
                        <tr key={it.id}>
                          <td>
                            <a onClick={() => setDetailConsignment(it.consignmentId)} style={{ cursor: 'pointer' }}>
                              {it.title}
                            </a>
                          </td>
                          <td>{CATEGORY[it.category]}</td>
                          <td><Badge map={ITEM_STATUS} value={it.status} /></td>
                          <td>
                            {ov ? <Badge map={OVERRUN_STATUS} value={ov.status} /> : <span className="muted">-</span>}
                          </td>
                          <td>
                            {it.location === 'WAREHOUSE' ? '在仓' : '卖家家中'}
                            {it.warehouseSlot && <span className="tag">{it.warehouseSlot}</span>}
                          </td>
                          <td><Money v={it.cleaningCost} /></td>
                          <td><Money v={it.refurbishCost} /></td>
                          <td>{String(it.deliveryRadiusKm) === '0' ? '仅自提' : `${it.deliveryRadiusKm}km`}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {['PREPARING', 'PHOTOGRAPHY'].includes(it.status) && (
                              <button className="btn ghost sm" style={{ marginRight: 4 }} onClick={() => setWorkFor(it)}>登记作业</button>
                            )}
                            {['PREPARING', 'PHOTOGRAPHY'].includes(it.status) && (
                              <button className="btn ghost sm" style={{ marginRight: 4 }} onClick={() => setOverrunFor(it)}>
                                超预算确认
                              </button>
                            )}
                            {['PREPARING', 'PHOTOGRAPHY'].includes(it.status) && (
                              <button className="btn ghost sm" style={{ marginRight: 4 }} onClick={() => setRephotoFor(it)}>
                                翻新后重拍
                              </button>
                            )}
                            {it.status === 'PREPARING' && (
                              <button className="btn sm" onClick={() => setAdvanceFor(it)}>清洁完成→拍照</button>
                            )}
                            {it.status === 'PHOTOGRAPHY' && (
                              <button className="btn sm" onClick={() => setAdvanceFor(it)}>完善信息→上架</button>
                            )}
                            {it.status === 'RETURNED' && (
                              <button className="btn sm" onClick={() => setAdvanceFor(it)}>返仓复检→重新上架</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
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
      {overrunFor && (
        <OverrunModal
          item={overrunFor}
          onClose={() => setOverrunFor(null)}
          onDone={() => { setOverrunFor(null); load(); }}
        />
      )}
      {rephotoFor && (
        <RephotoModal
          item={rephotoFor}
          onClose={() => setRephotoFor(null)}
          onDone={() => { setRephotoFor(null); load(); }}
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

/** 发起翻新成本超预算确认：推给卖家确认新增工时/材料、售价变化、上架时间影响 */
function OverrunModal({ item, onClose, onDone }: { item: any; onClose: () => void; onDone: () => void }) {
  const [detail, setDetail] = useState<any>(null);
  const [f, setF] = useState({
    reason: '',
    additionalLaborCost: 0,
    additionalMaterialCost: 0,
    revisedListedPrice: Number(item.listedPrice),
    affectListing: true,
    listingDelayDays: 2,
    beforePhotos: '',
    deviationReason: '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    api(`/items/${item.id}`).then(setDetail).catch(() => {});
  }, [item.id]);

  const appraisal = detail?.appraisal;
  const extra = Number(f.additionalLaborCost || 0) + Number(f.additionalMaterialCost || 0);

  const submit = async () => {
    if (!f.reason.trim()) return toast('请说明清洁时发现的新瑕疵（如餐桌划痕需重新打磨上漆）', true);
    if (extra <= 0) return toast('新增工时费与材料费之和需大于 0', true);
    if (!(Number(f.revisedListedPrice) > 0)) return toast('请填写翻新后预计售价', true);
    setBusy(true);
    try {
      await api(`/refurbish/items/${item.id}/overrun`, {
        body: {
          ...f,
          beforePhotos: f.beforePhotos ? f.beforePhotos.split(/[,，\s]+/).filter(Boolean) : [],
        },
      });
      toast('已推送给卖家确认，并生成协同工单');
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
      title={`发起翻新成本超预算确认 · ${item.title}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn gray" onClick={onClose}>取消</button>
          <button className="btn danger" disabled={busy} onClick={submit}>推送卖家确认</button>
        </>
      }
    >
      <div className="banner info">
        估价单预估翻新成本 <Money v={appraisal?.estimatedRefurbishCost ?? '0'} />，
        当前已发生翻新费 <Money v={item.refurbishCost} />。清洁时发现瑕疵比估价时严重时，
        把追加费用、预计售价变化与上架时间影响推给卖家；卖家接受后费用从成交款扣除，拒绝可降价上架或取消寄卖。
      </div>
      <Field label="发现的问题与需要追加的作业">
        <textarea
          style={{ minHeight: 80 }}
          value={f.reason}
          onChange={(e) => set('reason', e.target.value)}
          placeholder="如：清洁时发现餐桌表面划痕比估价时严重，已伤及漆面，需要重新整体打磨、补腻子、上漆两遍"
        />
      </Field>
      <div className="row2">
        <Field label="新增工时费（元）">
          <input type="number" min={0} value={f.additionalLaborCost} onChange={(e) => set('additionalLaborCost', +e.target.value)} />
        </Field>
        <Field label="新增材料费（元，如木蜡油/油漆/腻子）">
          <input type="number" min={0} value={f.additionalMaterialCost} onChange={(e) => set('additionalMaterialCost', +e.target.value)} />
        </Field>
        <Field label="当前寄卖价（元）">
          <input value={item.listedPrice} disabled />
        </Field>
        <Field label="翻新后预计售价（元）">
          <input type="number" min={0} value={f.revisedListedPrice} onChange={(e) => set('revisedListedPrice', +e.target.value)} />
        </Field>
      </div>
      <div className="row2">
        <label className="checkline">
          <input type="checkbox" checked={f.affectListing} onChange={(e) => set('affectListing', e.target.checked)} />
          影响上架时间（重新打磨上漆需要额外工期）
        </label>
        {f.affectListing && (
          <Field label="预计上架延后（天）">
            <input type="number" min={1} value={f.listingDelayDays} onChange={(e) => set('listingDelayDays', +e.target.value)} />
          </Field>
        )}
      </div>
      <Field label="翻新前现场照片链接（多个用逗号分隔，随确认单推给卖家）">
        <input value={f.beforePhotos} onChange={(e) => set('beforePhotos', e.target.value)} placeholder="https://…" />
      </Field>
      <Field label="估价偏差原因（仅平台内部保留，用于考核估价师，卖家不可见）">
        <textarea
          style={{ minHeight: 60 }}
          value={f.deviationReason}
          onChange={(e) => set('deviationReason', e.target.value)}
          placeholder="如：估价时桌面铺有桌垫且灯光昏暗，未发现贯穿性划痕；估价师未掀开桌垫检查"
        />
      </Field>
      <div className="card" style={{ background: '#f8fafc' }}>
        <b>卖家将看到</b>
        <div className="hint" style={{ marginTop: 6 }}>
          追加费用合计 <Money v={extra} />；预计售价 <Money v={item.listedPrice} /> → <Money v={f.revisedListedPrice} />；
          {f.affectListing ? ` 上架延后约 ${f.listingDelayDays} 天。` : ' 不影响上架时间。'}
        </div>
      </div>
    </Modal>
  );
}

/** 翻新完成后重新拍摄并更新瑕疵说明；旧照片转入内部审计归档 */
function RephotoModal({ item, onClose, onDone }: { item: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ photos: '', defectNote: '' });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const photos = f.photos ? f.photos.split(/[,，\s]+/).filter(Boolean) : [];
    if (photos.length === 0) return toast('请填写翻新后的重拍照片链接', true);
    if (!f.defectNote.trim()) return toast('请更新翻新后的瑕疵说明', true);
    setBusy(true);
    try {
      await api(`/items/${item.id}/rephotograph`, { body: { photos, defectNote: f.defectNote } });
      toast('已重新拍摄并更新瑕疵说明，旧照片已转入内部审计');
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
      title={`翻新完成 · 重新拍摄 · ${item.title}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn gray" onClick={onClose}>取消</button>
          <button className="btn" disabled={busy} onClick={submit}>保存重拍结果</button>
        </>
      }
    >
      <div className="banner info">
        买家看到的是翻新后的真实状态。保存后当前照片会转入内部审计归档，不再对买家/卖家展示。
        {item.archivedPhotos?.length ? ` 已有 ${item.archivedPhotos.length} 张旧照片归档。` : ''}
      </div>
      <Field label="翻新后照片链接（多个用逗号分隔）">
        <input value={f.photos} onChange={(e) => setF({ ...f, photos: e.target.value })} placeholder="https://…" />
      </Field>
      <Field label="翻新后瑕疵说明（如实描述仍存在的瑕疵，买家可见）">
        <textarea
          style={{ minHeight: 100 }}
          value={f.defectNote}
          onChange={(e) => setF({ ...f, defectNote: e.target.value })}
          placeholder="如：桌面已整体打磨上漆，近窗边侧光下仍可见极浅使用痕迹；桌腿一处补漆，颜色基本一致"
        />
      </Field>
    </Modal>
  );
}

/** 仓库视角的超预算确认单跟踪列表 */
function OverrunPanel({ user, onChanged }: { user: AuthUser; onChanged: () => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [status, setStatus] = useState('PENDING');

  const load = () => api(`/refurbish/overruns?status=${status === 'ALL' ? '' : status}`).then((r: any) => setRows(r || []));
  useEffect(() => { load(); }, [status]);

  return (
    <div>
      <div className="pill-filter">
        {[['PENDING', '待卖家确认'], ['ACCEPTED', '已接受'], ['REJECTED_REDUCE', '拒绝·降价'], ['REJECTED_CANCEL', '拒绝·取消'], ['ALL', '全部']].map(
          ([k, v]) => (
            <button key={k} className={status === k ? 'active' : ''} onClick={() => setStatus(k)}>{v}</button>
          ),
        )}
      </div>
      {rows.length === 0 ? (
        <Empty text="暂无超预算确认单" />
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>确认单号</th><th>商品</th><th>新增工时</th><th>新增材料</th>
                  <th>售价变化</th><th>上架影响</th><th>状态</th><th>估价偏差原因（内部考核）</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.code}</td>
                    <td>{r.itemTitle}</td>
                    <td><Money v={r.additionalLaborCost} /></td>
                    <td><Money v={r.additionalMaterialCost} /></td>
                    <td>
                      <Money v={r.currentListedPrice} /> → <Money v={r.revisedListedPrice} />
                    </td>
                    <td>{r.affectListing ? `延后约 ${r.listingDelayDays} 天` : '不影响'}</td>
                    <td><Badge map={OVERRUN_STATUS} value={r.status} /></td>
                    <td className="muted" style={{ maxWidth: 260 }}>{r.deviationReason || '-'}</td>
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

function AdvanceModal({ item, onClose, onDone }: { item: any; onClose: () => void; onDone: () => void }) {
  const isPreparing = item.status === 'PREPARING';
  const [f, setF] = useState({
    description: item.description || '',
    photos: (item.photos || []).join(','),
    defectNote: item.defectNote || '',
    warehouseSlot: item.warehouseSlot || '',
    deliveryRadiusKm: item.deliveryRadiusKm,
    listedPrice: Number(item.listedPrice),
  });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      if (isPreparing) {
        await api(`/items/${item.id}/advance`, { body: { to: 'PHOTOGRAPHY' } });
        toast('已进入拍照环节');
      } else {
        await api(`/items/${item.id}/advance`, {
          body: {
            to: 'LISTED',
            description: f.description,
            photos: f.photos ? f.photos.split(/[,，\s]+/).filter(Boolean) : [],
            defectNote: f.defectNote,
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
          若划痕等瑕疵比估价时严重、需要重新打磨上漆，请先「超预算确认」推给卖家；
          追加翻新完成后请用「翻新后重拍」更新照片与瑕疵说明。
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
          <button className="btn" disabled={busy} onClick={submit}>确认上架</button>
        </>
      }
    >
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
        <Field label="照片链接（逗号分隔，买家所见为翻新后照片）">
          <input value={f.photos} onChange={(e) => setF({ ...f, photos: e.target.value })} />
        </Field>
      </div>
      <Field label="瑕疵说明（翻新后的真实状态，买家可见）">
        <textarea style={{ minHeight: 80 }} value={f.defectNote} onChange={(e) => setF({ ...f, defectNote: e.target.value })}
          placeholder="如实写明翻新后仍存在的瑕疵；旧瑕疵说明只保留在内部审计记录中" />
      </Field>
      <Field label="上架描述（成色、尺寸、通道/电梯适配提示等）">
        <textarea style={{ minHeight: 110 }} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })}
          placeholder="建议写明：实际成色、已完成的清洁翻新（含打磨上漆）、最小通道/电梯尺寸要求、是否可拆装" />
      </Field>
    </Modal>
  );
}
