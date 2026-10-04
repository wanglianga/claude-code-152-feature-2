import { useEffect, useState } from 'react';
import { api } from '../api';
import { Money, Empty } from '../ui';
import { TICKET_TYPE, FAIL_REASON, DEVIATION_CATEGORY } from '../labels';

export function OpsView() {
  const [data, setData] = useState<any>(null);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [deviations, setDeviations] = useState<any>(null);

  useEffect(() => {
    api('/analytics/by-category').then(setData);
    api('/analytics/seller-profiles').then(setProfiles);
    api('/analytics/appraiser-deviations').then(setDeviations).catch(() => {});
  }, []);

  if (!data) return <div className="empty">加载中…</div>;
  const cats = data.categories;
  const totalSold = cats.reduce((s: number, c: any) => s + c.soldCount, 0);
  const totalListed = cats.reduce((s: number, c: any) => s + c.listedCount, 0);
  const avgCycle = (() => {
    const v = cats.filter((c: any) => c.avgCycleDays != null).map((c: any) => c.avgCycleDays);
    return v.length ? (v.reduce((a: number, b: number) => a + b, 0) / v.length).toFixed(1) : '-';
  })();
  const totalFailed = cats.reduce((s: number, c: any) => s + c.deliveryFailed, 0);
  const totalDeliveries = cats.reduce((s: number, c: any) => s + c.deliveryTotal, 0);
  const failRate = totalDeliveries ? ((totalFailed / totalDeliveries) * 100).toFixed(1) : '0';

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>运营分析</h2>
          <div className="sub">按品类沉淀成交周期、翻新投入、退货原因与配送失败率，判断入仓寄卖还是同城自提</div>
        </div>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <div className="card stat"><div className="l">在售/曾上架</div><div className="v">{totalListed}</div></div>
        <div className="card stat"><div className="l">累计成交</div><div className="v">{totalSold}</div></div>
        <div className="card stat"><div className="l">品类平均成交周期</div><div className="v">{avgCycle}<span style={{ fontSize: 14 }}> 天</span></div></div>
        <div className="card stat"><div className="l">整体配送失败率</div><div className="v">{failRate}%</div><div className="d">{totalFailed}/{totalDeliveries} 单</div></div>
      </div>

      <div className="card" style={{ padding: 0, marginBottom: 18 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>品类</th><th>上架/成交</th><th>平均成交周期</th><th>平均翻新投入</th>
                <th>翻新占均价比</th><th>退货率</th><th>配送失败率</th><th>主要退货/失败原因</th><th>渠道建议</th>
              </tr>
            </thead>
            <tbody>
              {cats.map((c: any) => (
                <tr key={c.category}>
                  <td><b>{c.categoryLabel}</b></td>
                  <td>{c.listedCount} / {c.soldCount}</td>
                  <td>{c.avgCycleDays == null ? '-' : `${c.avgCycleDays} 天`}</td>
                  <td>
                    <Money v={c.avgRefurbishCost} />
                    <div className="hint">均价 <Money v={c.avgDealPrice} /></div>
                  </td>
                  <td>{c.refurbishCostRatioPct}%</td>
                  <td>
                    <span className={c.returnRatePct >= 20 ? 'money-out' : ''}>{c.returnRatePct}%</span>
                    <div className="hint">{c.returnCount} 单退货</div>
                  </td>
                  <td>
                    <span className={c.deliveryFailRatePct >= 25 ? 'money-out' : ''}>{c.deliveryFailRatePct}%</span>
                    <div className="hint">{c.deliveryFailed}/{c.deliveryTotal} 单</div>
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {Object.entries(c.returnReasons).map(([k, v]) => (
                      <div key={k}>{TICKET_TYPE[k] || k} ×{String(v)}</div>
                    ))}
                    {Object.entries(c.deliveryFailReasons).map(([k, v]) => (
                      <div key={k} className="muted">{FAIL_REASON[k] || k} ×{String(v)}</div>
                    ))}
                    {Object.keys(c.returnReasons).length + Object.keys(c.deliveryFailReasons).length === 0 && '-'}
                  </td>
                  <td style={{ minWidth: 220 }}>
                    <div className={`banner ${c.channelAdvice.includes('自提') ? 'warn' : c.channelAdvice.includes('适合入仓') ? 'info' : ''}`} style={{ margin: 0 }}>
                      {c.channelAdvice}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section-title">卖家风险画像（再次寄卖验真依据）</div>
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>卖家</th><th>风险分</th><th>验真等级</th><th>反悔</th>
                <th>描述不符</th><th>售后争议</th><th>成交</th><th>说明</th>
              </tr>
            </thead>
            <tbody>
              {profiles.length === 0 && <tr><td colSpan={8}><Empty text="暂无卖家画像" /></td></tr>}
              {profiles.map((p) => (
                <tr key={p.id}>
                  <td><b>{p.sellerName}</b><div className="hint">{p.username}</div></td>
                  <td>
                    <b style={{ color: Number(p.riskScore) >= 4 ? '#dc2626' : '#16a34a' }}>{p.riskScore}</b>
                  </td>
                  <td>
                    <span className={`badge ${p.verificationLevel === 'STRICT' ? 'red' : 'green'}`}>
                      {p.verificationLevel === 'STRICT' ? '严格验真' : '常规'}
                    </span>
                  </td>
                  <td>{p.backtrackCount}</td>
                  <td>{p.mismatchCount}</td>
                  <td>{p.disputeCount}</td>
                  <td>{p.completedCount}</td>
                  <td className="muted" style={{ maxWidth: 280 }}>{p.riskNote}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="hint" style={{ marginTop: 10 }}>
        风险分 = 反悔次数×3 + 描述不符×2 + 售后争议×1 − 成交数×0.5；≥4 分或描述不符 ≥2 次，新寄卖自动进入严格上门验真。
      </div>

      <div className="section-title">估价师估价偏差考核（翻新超预算归因）</div>
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>估价师</th><th>超预算单数</th><th>现场低估</th><th>卖家申报失真</th>
                <th>不可预见</th><th>低估占比</th><th>追加预算合计</th><th>待卖家确认</th>
              </tr>
            </thead>
            <tbody>
              {!deviations || deviations.appraisers.length === 0 ? (
                <tr><td colSpan={8}><Empty text="暂无估价偏差记录" /></td></tr>
              ) : (
                deviations.appraisers.map((a: any) => (
                  <tr key={a.appraiserId}>
                    <td><b>{a.appraiserName}</b></td>
                    <td>{a.total}</td>
                    <td>
                      <span className={a.underestimate > 0 ? 'money-out' : ''}>{a.underestimate}</span>
                      <div className="hint">
                        {DEVIATION_CATEGORY.APPRAISER_UNDERESTIMATE.label}
                      </div>
                    </td>
                    <td>{a.sellerMisdescribe}<div className="hint">{DEVIATION_CATEGORY.SELLER_MISDESCRIBE.label}</div></td>
                    <td>{a.unforeseeable}<div className="hint">{DEVIATION_CATEGORY.UNFORESEEABLE.label}</div></td>
                    <td className={a.underestimateRatePct >= 30 ? 'money-out' : ''}>{a.underestimateRatePct}%</td>
                    <td><Money v={a.extraTotal} /></td>
                    <td>{a.pendingSeller}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="hint" style={{ marginTop: 10 }}>
        数据来源：翻新超预算确认单的估价偏差归因（仓库发起时初判，运营可在单据上复核调整）；
        「现场低估」占比与追加预算金额作为估价师考核依据，「不可预见」不纳入考核。
      </div>
    </div>
  );
}
