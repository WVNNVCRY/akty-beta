import { useEffect, useMemo, useState } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { App as AntApp, Badge, Button, Drawer, Grid, Layout, Menu, Popconfirm, Select, Spin, Tooltip } from 'antd';
import {
  AuditOutlined, BellOutlined, CloudUploadOutlined, DashboardOutlined, EnvironmentOutlined,
  FieldTimeOutlined, FileTextOutlined, InboxOutlined, LogoutOutlined, MenuOutlined, SettingOutlined, TeamOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useMe, useStore } from './store';
import { ROLE_LABEL } from './types';
import { checkReminders, nowMs } from './engine';
import { clearFiles } from './files';
import { API_MODE } from './api';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Objects from './pages/Objects';
import ObjectCard from './pages/ObjectCard';
import MyForms from './pages/MyForms';
import Acts from './pages/Acts';
import ActCard from './pages/ActCard';
import Archive from './pages/Archive';
import Notifications from './pages/Notifications';
import Settings from './pages/Settings';
import Admin from './pages/Admin';
import ImportStub from './pages/ImportStub';

const { Header, Sider, Content } = Layout;

function Shell() {
  const me = useMe()!;
  const nav = useNavigate();
  const loc = useLocation();
  const { message } = AntApp.useApp();
  const users = useStore((s) => s.users);
  const notifications = useStore((s) => s.notifications);
  const clockOffsetDays = useStore((s) => s.clockOffsetDays);
  const run = useStore((s) => s.run);
  const loginAs = useStore((s) => s.loginAs);
  const logout = useStore((s) => s.logout);
  const reset = useStore((s) => s.reset);
  const unread = notifications.filter((n) => n.userId === me.id && !n.read).length;

  const items = useMemo(() => {
    const staff = me.role === 'GC' || me.role === 'MANAGER';
    const arr: any[] = [];
    if (staff) arr.push({ key: '/', icon: <DashboardOutlined />, label: 'Сводка' });
    if (me.role === 'CLIENT') arr.push({ key: '/', icon: <AuditOutlined />, label: 'Акты' });
    arr.push({ key: '/objects', icon: <EnvironmentOutlined />, label: me.role === 'CONTRACTOR' ? 'Мои объекты' : 'Объекты' });
    if (me.role === 'CONTRACTOR') arr.push({ key: '/forms', icon: <FileTextOutlined />, label: 'Мои формы' });
    if (staff) arr.push({ key: '/acts', icon: <AuditOutlined />, label: 'Акты' });
    if (staff) arr.push({ key: '/import', icon: <CloudUploadOutlined />, label: 'Импорт Excel' });
    arr.push({ key: '/archive', icon: <InboxOutlined />, label: 'Архив' });
    arr.push({
      key: '/notifications', icon: <BellOutlined />,
      label: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>Уведомления {unread > 0 && <Badge count={unread} size="small" />}</span>,
    });
    arr.push({ key: '/settings', icon: <SettingOutlined />, label: 'Настройки' });
    if (me.role === 'GC') arr.push({ key: '/admin', icon: <TeamOutlined />, label: 'Администрирование' });
    return arr;
  }, [me.role, unread]);

  const selected = '/' + (loc.pathname.split('/')[1] || '');
  const screens = Grid.useBreakpoint();
  const mobile = !screens.lg;
  const [drawer, setDrawer] = useState(false);
  useEffect(() => setDrawer(false), [loc.pathname]);

  const brand = (
    <div className="app-brand">
      <div className="app-brand-title"><span className="app-brand-mark" />Акты скрытых работ</div>
      <div className="app-brand-sub">дорожная разметка · бета</div>
    </div>
  );
  const menu = <Menu theme="dark" mode="inline" selectedKeys={[selected]} items={items} onClick={(e) => nav(e.key)} style={{ borderInlineEnd: 0 }} />;

  const demoBar = !API_MODE && (
    <div className="demo-bar">
      <span className="demo-badge">ДЕМО</span>
      <Tooltip title="Сдвиг времени для проверки напоминаний (2 и 5 дней) и блока «Требует внимания»">
        <span className="tnum"><FieldTimeOutlined /> {dayjs(nowMs({ clockOffsetDays } as any)).format('DD.MM.YYYY')}{clockOffsetDays ? ` (+${clockOffsetDays} дн.)` : ''}</span>
      </Tooltip>
      <Button size="small" onClick={() => {
        run((d) => {
          d.clockOffsetDays += 1;
          checkReminders(d);
        });
        message.info('Время сдвинуто на 1 день вперёд, напоминания проверены');
      }}>+1 день</Button>
      <Select
        size="small"
        style={{ width: mobile ? '100%' : 280 }}
        value={me.id}
        onChange={(v) => {
          loginAs(v);
          nav('/');
        }}
        options={users.filter((u) => u.active).map((u) => ({ value: u.id, label: `${u.name} — ${ROLE_LABEL[u.role]}` }))}
        popupMatchSelectWidth={false}
      />
      <Popconfirm title="Сбросить данные демо-режима?" description="Объекты, формы, акты и уведомления будут удалены. Пользователи и справочники сохранятся." okText="Сбросить" okButtonProps={{ danger: true }} onConfirm={async () => {
        await clearFiles();
        reset();
        nav('/');
      }}>
        <Button size="small" danger>Сброс</Button>
      </Popconfirm>
    </div>
  );

  return (
    <Layout style={{ minHeight: '100vh', background: mobile ? undefined : '#1f252c' }}>
      {!mobile && (
        <Sider width={232} style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'auto' }}>
          {brand}
          {menu}
        </Sider>
      )}
      <Drawer className="app-drawer" placement="left" width={264} open={mobile && drawer} onClose={() => setDrawer(false)} closable={false}>
        {brand}
        <div style={{ padding: '0 18px 12px', color: '#e7ebef' }}>
          <div style={{ fontWeight: 500 }}>{me.name}</div>
          <div style={{ fontSize: 12, color: '#97a3b0' }}>{ROLE_LABEL[me.role]}</div>
        </div>
        {menu}
      </Drawer>
      <Layout>
        <Header className="app-header">
          {mobile && <Button type="text" icon={<MenuOutlined />} onClick={() => setDrawer(true)} style={{ color: '#e7ebef' }} aria-label="Меню" />}
          {mobile && <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>Акты скрытых работ</span>}
          {!mobile && demoBar}
          {API_MODE && !mobile && <span className="app-mode">Сервер</span>}
          <div style={{ flex: 1 }} />
          <Badge count={unread} size="small" offset={[-2, 2]}>
            <Button icon={<BellOutlined />} onClick={() => nav('/notifications')} aria-label="Уведомления" />
          </Badge>
          {!mobile && (
            <div className="app-user">
              <span className="app-user-name">{me.name}</span>
              <span className="app-user-role">{ROLE_LABEL[me.role]}</span>
            </div>
          )}
          <Tooltip title={mobile ? 'Выйти' : undefined}>
            <Button icon={<LogoutOutlined />} onClick={() => { logout(); nav('/'); }}>{mobile ? null : 'Выйти'}</Button>
          </Tooltip>
        </Header>
        {mobile && demoBar && <div style={{ background: '#272e36', padding: '0 12px 10px' }}>{demoBar}</div>}
        <Content className="app-content">
          <Routes>
            <Route path="/" element={me.role === 'CONTRACTOR' ? <Objects /> : me.role === 'CLIENT' ? <Acts /> : <Dashboard />} />
            <Route path="/objects" element={<Objects />} />
            <Route path="/objects/:id" element={<ObjectCard />} />
            <Route path="/forms" element={<MyForms />} />
            <Route path="/acts" element={<Acts />} />
            <Route path="/acts/:id" element={<ActCard />} />
            <Route path="/archive" element={<Archive />} />
            <Route path="/import" element={<ImportStub />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/admin" element={me.role === 'GC' ? <Admin /> : <Navigate to="/" />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}

/** API-режим: первая загрузка снимка и автообновление (новые уведомления, чат, действия других участников). */
function useServerSync() {
  const userId = useStore((s) => s.currentUserId);
  const refresh = useStore((s) => s.refresh);
  const logout = useStore((s) => s.logout);
  useEffect(() => {
    if (!API_MODE || !userId) return;
    refresh().catch(() => logout());
    const tick = () => { if (document.visibilityState === 'visible') refresh().catch(() => undefined); };
    const timer = setInterval(tick, 15_000);
    window.addEventListener('focus', tick);
    return () => { clearInterval(timer); window.removeEventListener('focus', tick); };
  }, [userId, refresh, logout]);
}

export default function App() {
  useServerSync();
  const me = useMe();
  const userId = useStore((s) => s.currentUserId);
  const loaded = useStore((s) => s.loaded);
  if (API_MODE && userId && !loaded) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spin size="large" tip="Загрузка данных…"><div style={{ padding: 50 }} /></Spin></div>;
  }
  return <HashRouter>{me ? <Shell /> : <Login />}</HashRouter>;
}
