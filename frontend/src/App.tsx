import { useState } from 'react';
import { api, setAuth, AuthUser, clearAuth, getToken, getUser } from './api';
import { ToastHost } from './ui';
import { ROLE, ROLE_COLOR } from './labels';
import { Login } from './views/Login';
import { SellerView } from './views/Seller';
import { BuyerView } from './views/Buyer';
import { AppraiserView } from './views/Appraiser';
import { WarehouseView } from './views/Warehouse';
import { DeliveryView } from './views/Delivery';
import { CsView } from './views/Cs';
import { OpsView } from './views/Ops';
import { SellerOverrunsView } from './views/Overruns';

interface TabDef {
  key: string;
  label: string;
  roles: string[];
  render: (user: AuthUser, go: (k: string) => void) => React.ReactNode;
}

const TABS: TabDef[] = [
  { key: 'seller', label: '我的寄卖', roles: ['SELLER'], render: (u, go) => <SellerView user={u} go={go} /> },
  { key: 'seller-overruns', label: '翻新预算确认', roles: ['SELLER'], render: () => <SellerOverrunsView /> },
  { key: 'market', label: '寄卖市场', roles: ['BUYER'], render: () => <BuyerView mode="market" /> },
  { key: 'my-orders', label: '我的订单/售后', roles: ['BUYER'], render: () => <BuyerView mode="orders" /> },
  { key: 'appraisal', label: '上门估价', roles: ['APPRAISER'], render: () => <AppraiserView /> },
  { key: 'warehouse', label: '翻新上架', roles: ['WAREHOUSE', 'REFURBISHER', 'OPS', 'ADMIN'], render: (u) => <WarehouseView user={u} /> },
  { key: 'delivery', label: '配送调度', roles: ['DELIVERY'], render: () => <DeliveryView /> },
  { key: 'tickets', label: '协同工单', roles: ['CS', 'ADMIN'], render: () => <CsView mode="tickets" /> },
  { key: 'settlements', label: '结算单', roles: ['CS', 'OPS', 'ADMIN'], render: () => <CsView mode="settlements" /> },
  { key: 'analytics', label: '运营分析', roles: ['OPS', 'ADMIN'], render: () => <OpsView /> },
  { key: 'seller-settlement', label: '我的结算', roles: ['SELLER'], render: (u) => <SellerView user={u} go={() => {}} mode="settlements" /> },
];

export function App() {
  const [user, setUser] = useState<AuthUser | null>(() => (getToken() ? getUser() : null));
  const [tab, setTab] = useState('');

  if (!user) {
    return (
      <>
        <Login
          onLogin={(token, u) => {
            setAuth(token, u);
            setUser(u);
            setTab('');
          }}
        />
        <ToastHost />
      </>
    );
  }

  const tabs = TABS.filter((t) => t.roles.includes(user.role));
  const active = tabs.find((t) => t.key === tab) || tabs[0];

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="logo">🪑 邻栖寄卖</div>
        <div className="tabs">
          {tabs.map((t) => (
            <button
              key={t.key}
              className={active?.key === t.key ? 'active' : ''}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="userbox">
          <span className={`badge ${ROLE_COLOR[user.role] || 'gray'}`}>{ROLE[user.role]}</span>
          <span className="name">{user.name}</span>
          <button
            className="btn ghost sm btn-logout"
            onClick={() => {
              clearAuth();
              setUser(null);
            }}
          >
            退出
          </button>
        </div>
      </div>
      <div className="container">{active?.render(user, setTab)}</div>
      <ToastHost />
    </div>
  );
}
