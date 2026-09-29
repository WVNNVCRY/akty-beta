import { useMemo } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { App as AntApp, Badge, Button, Layout, Menu, Popconfirm, Select, Space, Tag, Tooltip, Typography } from 'antd';
import {
  AppstoreOutlined, AuditOutlined, BellOutlined, CloudUploadOutlined, DashboardOutlined, EnvironmentOutlined,
  FieldTimeOutlined, FileTextOutlined, InboxOutlined, LogoutOutlined, SettingOutlined, TeamOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useMe, useStore } from './store';
import { ROLE_LABEL } from './types';
import { checkReminders, nowMs } from './engine';
import { clearFiles } from './files';
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
    if (staff) arr.push({ key: '/', icon: <DashboardOutlined />, label: 'Дашборд' });
    if (me.role === 'CLIENT') arr.push({ key: '/', icon: <AuditOutlined />, label: 'Акты' });
    arr.push({ key: '/objects', icon: <EnvironmentOutlined />, label: me.role === 'CONTRACTOR' ? 'Мои объекты' : 'Объекты' });
    if (me.role === 'CONTRACTOR') arr.push({ key: '/forms', icon: <FileTextOutlined />, label: 'Мои формы' });
    if (staff) arr.push({ key: '/acts', icon: <AuditOutlined />, label: 'Акты' });
    if (staff) arr.push({ key: '/import', icon: <CloudUploadOutlined />, label: 'Импорт Excel' });
    arr.push({ key: '/archive', icon: <InboxOutlined />, label: 'Архив' });
    arr.push({
      key: '/notifications', icon: <BellOutlined />,
      label: <span>Уведомления {unread > 0 && <Badge count={unread} size="small" style={{ marginLeft: 6 }} />}</span>,
    });
    arr.push({ key: '/settings', icon: <SettingOutlined />, label: 'Настройки' });
    if (me.role === 'GC') arr.push({ key: '/admin', icon: <TeamOutlined />, label: 'Админка' });
    return arr;
  }, [me.role, unread]);

  const selected = '/' + (loc.pathname.split('/')[1] || '');

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider breakpoint="lg" collapsedWidth={0} width={220} theme="light" style={{ borderRight: '1px solid #f0f0f0' }}>
        <div style={{ padding: '16px 16px 8px', fontWeight: 700, lineHeight: 1.2 }}>
          <AppstoreOutlined style={{ color: '#1677ff' }} /> Акты скрытых работ
          <div style={{ fontSize: 11, fontWeight: 400, color: '#999', marginTop: 4 }}>дорожная разметка · бета</div>
        </div>
        <Menu mode="inline" selectedKeys={[selected]} items={items} onClick={(e) => nav(e.key)} style={{ borderRight: 0 }} />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 16px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', height: 'auto', minHeight: 64, lineHeight: '64px' }}>
          <Space style={{ background: '#fffbe6', border: '1px dashed #faad14', borderRadius: 6, padding: '0 8px', lineHeight: '36px' }} wrap>
            <Tag color="orange">ДЕМО</Tag>
            <Tooltip title="Сдвиг времени для проверки напоминаний (2 / 5 дней) и виджета «Проблемные акты»">
              <span><FieldTimeOutlined /> {dayjs(nowMs({ clockOffsetDays } as any)).format('DD.MM.YYYY')}{clockOffsetDays ? ` (+${clockOffsetDays} дн.)` : ''}</span>
            </Tooltip>
            <Button size="small" onClick={() => {
              run((d) => {
                d.clockOffsetDays += 1;
                checkReminders(d);
              });
              message.info('Время сдвинуто на +1 день, напоминания проверены');
            }}>+1 день</Button>
            <Select
              size="small"
              style={{ width: 260 }}
              value={me.id}
              onChange={(v) => {
                loginAs(v);
                nav('/');
              }}
              options={users.filter((u) => u.active).map((u) => ({ value: u.id, label: `${u.name} — ${ROLE_LABEL[u.role]}` }))}
            />
            <Popconfirm title="Сбросить все данные к демо-набору?" onConfirm={async () => {
              await clearFiles();
              reset();
              nav('/');
            }}>
              <Button size="small" danger>Сброс</Button>
            </Popconfirm>
          </Space>
          <div style={{ flex: 1 }} />
          <Badge count={unread} size="small">
            <Button shape="circle" icon={<BellOutlined />} onClick={() => nav('/notifications')} />
          </Badge>
          <Typography.Text>
            {me.name} <Tag>{ROLE_LABEL[me.role]}</Tag>
          </Typography.Text>
          <Button icon={<LogoutOutlined />} onClick={() => { logout(); nav('/'); }}>Выйти</Button>
        </Header>
        <Content style={{ padding: 20, background: '#f5f7fa' }}>
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

export default function App() {
  const me = useMe();
  return <HashRouter>{me ? <Shell /> : <Login />}</HashRouter>;
}
