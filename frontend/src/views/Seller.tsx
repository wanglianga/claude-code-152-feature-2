import { useEffect, useState } from 'react';
import { api, AuthUser } from '../api';
import {
  Badge, Modal, Field, Money, Empty, useLoader,
} from '../ui';
import { CATEGORY, ELEVATOR, CONSIGNMENT_STATUS, SETTLEMENT_TYPE } from '../labels';
import { ConsignmentDetail } from './ConsignmentDetail';

export function SellerView({ user, go, mode = 'list' }: { user: AuthUser; go: (k: string) => void; mode?: 'list' | 'settlements' }) {
  const [list, setList] = useState<any[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [pendingOverruns, setPendingOverruns] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [page, setPage] = useState(mode);

  useEffect(() => {
    setPage(mode);
  }, [mode]);

  const load = () => {
    api('/consignments').then(setList);
    api('/analytics/seller-profiles/' + user.id).then(setProfile).catch(() => {});
    api('/refurbish-overruns?status=PENDING_SELLER')
      .then((rs: any[]) => setPendingOverruns(rs))
      .catch(() => {});
  };
  useEffect(load, [user.id]);

  if (detailId) {
    return <ConsignmentDetail id={detailId} onBack={() => setDetailId(null)} viewerRole="SELLER" />;
  }

  if (page === 'settlements') {
    return <MySettlements list={list} />;
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>我的寄卖</h2>
          <div className="sub">提交申请时系统会引用你的历史履约记录，决定上门验真等级</div>
        </div>
        <button className="btn" onClick={() => setShowCreate(true)}>
          ＋ 提交寄卖申请
        </button>
      </div>

      {profile && (
        <div className={`banner ${profile.verificationLevel === 'STRICT' ? 'risk' : 'info'}`}>
          我的信用画像：风险分 <b>{profile.riskScore}</b>（反悔 {profile.backtrackCount} 次 · 描述不符{' '}
          {profile.mismatchCount} 次 · 售后争议 {profile.disputeCount} 次 · 成交 {profile.completedCount} 次）
          ，下次上门验真：
          <b>{profile.verificationLevel === 'STRICT' ? '严格验真（逐项核对）' : '常规验真'}</b>
          <div className="hint" style={{ color: 'inherit' }}>{profile.riskNote}</div>
        </div>
      )}

      {pendingOverruns.length > 0 && (
        <div className="banner risk" style={{ cursor: 'pointer' }} onClick={() => go('seller-overruns')}>
          你有 <b>{pendingOverruns.length}</b> 张翻新超预算确认单待处理：仓库清洁时发现估价时未预见的问题，
          需你确认新增工时/材料费与售价、上架时间变化。<b>点击前往确认 →</b>
        </div>
      )}

      {list.length === 0 ? (
        <Empty text="还没有寄卖记录，点击右上角提交第一件家具" />
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>单号</th><th>品类</th><th>品牌</th><th>期望价</th>
                  <th>验真等级</th><th>状态</th><th>提交时间</th><th></th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id}>
                    <td>{c.code}</td>
                    <td>{CATEGORY[c.category]}</td>
                    <td>{c.brand}</td>
                    <td><Money v={c.expectedPrice} /></td>
                    <td>
                      <span className={`badge ${c.verificationLevel === 'STRICT' ? 'red' : 'gray'}`}>
                        {c.verificationLevel === 'STRICT' ? '严格验真' : '常规'}
                      </span>
                    </td>
                    <td><Badge map={CONSIGNMENT_STATUS} value={c.status} /></td>
                    <td className="muted">{new Date(c.createdAt).toLocaleDateString()}</td>
                    <td>
                      <button className="btn ghost sm" onClick={() => setDetailId(c.id)}>详情</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showCreate && (
        <CreateConsignment
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function CreateConsignment({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [f, setF] = useState({
    category: 'SOFA', brand: '', sizeText: '', material: '', yearsUsed: 2,
    defectPhotos: '', disassemblable: true, floor: 1, elevator: 'ELEVATOR',
    expectedPrice: 500, acceptRefurbish: true, address: '', sellerNote: '',
  });
  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));
  const { loading, error, run } = useLoader();

  const submit = () =>
    run(
      () =>
        api('/consignments', {
          body: {
            ...f,
            defectPhotos: f.defectPhotos
              ? f.defectPhotos.split(/[,，\s]+/).filter(Boolean)
              : [],
          },
        }),
      '寄卖申请已提交',
      onCreated,
    );

  return (
    <Modal
      wide
      title="提交寄卖申请"
      onClose={onClose}
      footer={
        <>
          <button className="btn gray" onClick={onClose}>取消</button>
          <button className="btn" disabled={loading} onClick={submit}>提交申请</button>
        </>
      }
    >
      <div className="row2">
        <Field label="品类">
          <select value={f.category} onChange={(e) => set('category', e.target.value)}>
            {Object.entries(CATEGORY).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="品牌">
          <input value={f.brand} onChange={(e) => set('brand', e.target.value)} placeholder="如 顾家家居" />
        </Field>
        <Field label="尺寸（长×宽×高）">
          <input value={f.sizeText} onChange={(e) => set('sizeText', e.target.value)} placeholder="如 220x95x85 cm" />
        </Field>
        <Field label="材质">
          <input value={f.material} onChange={(e) => set('material', e.target.value)} placeholder="如 头层牛皮+实木框架" />
        </Field>
        <Field label="使用年限">
          <input type="number" min={0} value={f.yearsUsed} onChange={(e) => set('yearsUsed', +e.target.value)} />
        </Field>
        <Field label="期望售价（元）">
          <input type="number" min={0} value={f.expectedPrice} onChange={(e) => set('expectedPrice', +e.target.value)} />
        </Field>
        <Field label="所在楼层">
          <input type="number" min={1} value={f.floor} onChange={(e) => set('floor', +e.target.value)} />
        </Field>
        <Field label="电梯条件">
          <select value={f.elevator} onChange={(e) => set('elevator', e.target.value)}>
            {Object.entries(ELEVATOR).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="瑕疵照片链接（多个用逗号分隔，可选）">
        <input value={f.defectPhotos} onChange={(e) => set('defectPhotos', e.target.value)} placeholder="https://…" />
      </Field>
      <Field label="地址">
        <input value={f.address} onChange={(e) => set('address', e.target.value)} placeholder="小区+门牌，便于估价师上门" />
      </Field>
      <Field label="备注（瑕疵、购买渠道等）">
        <textarea value={f.sellerNote} onChange={(e) => set('sellerNote', e.target.value)} />
      </Field>
      <div className="row2">
        <label className="checkline">
          <input type="checkbox" checked={f.disassemblable} onChange={(e) => set('disassemblable', e.target.checked)} />
          可拆装
        </label>
        <label className="checkline">
          <input type="checkbox" checked={f.acceptRefurbish} onChange={(e) => set('acceptRefurbish', e.target.checked)} />
          接受清洁翻新（费用从售价中扣除）
        </label>
      </div>
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}

export function MySettlements({ list }: { list: any[] }) {
  const [orders, setOrders] = useState<any[]>([]);
  const [settlements, setSettlements] = useState<Record<string, any>>({});

  useEffect(() => {
    api('/orders').then(async (os: any[]) => {
      setOrders(os);
      const map: Record<string, any> = {};
      await Promise.all(
        os.map(async (o) => {
          try {
            map[o.id] = await api(`/settlements/order/${o.id}`);
          } catch {
            /* 未结算 */
          }
        }),
      );
      setSettlements(map);
    });
  }, []);

  const settled = orders.filter((o) => settlements[o.id]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>我的结算</h2>
          <div className="sub">成交价、佣金、翻新费、仓储费、配送费与售后赔付均逐项列明来源</div>
        </div>
      </div>
      {settled.length === 0 ? (
        <Empty text="暂无已结算订单" />
      ) : (
        <div className="grid">
          {settled.map((o) => {
            const s = settlements[o.id];
            return (
              <div className="card" key={o.id}>
                <h3>
                  订单 {o.code}
                  <span style={{ float: 'right' }}>
                    应得 <Money v={s.settlement.sellerPayout} className="money-in" />
                  </span>
                </h3>
                <table>
                  <tbody>
                    {s.entries.map((e: any) => (
                      <tr key={e.id}>
                        <td style={{ width: 130 }}>{SETTLEMENT_TYPE[e.type]}</td>
                        <td>{e.source}</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <Money
                            v={e.amount}
                            className={e.type === 'SELLER_PAYOUT' ? 'money-in' : ''}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
