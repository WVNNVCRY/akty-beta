import { useState } from 'react';
import { App as AntApp, Button, Card, Divider, Form, Input, Space, Tag, Typography } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useStore } from '../store';
import { ROLE_LABEL, type Role } from '../types';
import { API_MODE } from '../api';

/** Демо-логины для быстрого входа на тестовом сервере (пароль 123). На проде — VITE_DEMO_LOGINS=0. */
const DEMO_LOGINS: { login: string; name: string; role: Role }[] = [
  { login: 'gc', name: 'Иванов И. И. (ГП)', role: 'GC' },
  { login: 'manager', name: 'Петрова А. С. (менеджер)', role: 'MANAGER' },
  { login: 'mech', name: 'Кузнецов Д. (Механика-Дор)', role: 'CONTRACTOR' },
  { login: 'hand', name: 'Соколов В. (ИП Соколов)', role: 'CONTRACTOR' },
  { login: 'thermo', name: 'Орлов П. (ТермоЛиния)', role: 'CONTRACTOR' },
  { login: 'client', name: 'Смирнова Е. (ГБУ АД ЦАО)', role: 'CLIENT' },
  { login: 'client2', name: 'Волков Н. (ГБУ АД САО)', role: 'CLIENT' },
];
const SHOW_DEMO = !API_MODE || import.meta.env.VITE_DEMO_LOGINS !== '0';

export default function Login() {
  const login = useStore((s) => s.login);
  const loginAs = useStore((s) => s.loginAs);
  const users = useStore((s) => s.users);
  const { message } = AntApp.useApp();
  const [loading, setLoading] = useState(false);
  return (
    <div className="login-page">
      <Card style={{ width: '100%', maxWidth: 440 }} styles={{ body: { padding: '28px 28px 24px' } }}>
        <div className="app-brand-title" style={{ marginBottom: 14, fontSize: 13, color: '#5f6b78', fontWeight: 500 }}><span className="app-brand-mark" />Дорожная разметка · бета</div>
        <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 8, lineHeight: 1.3 }}>Согласование актов освидетельствования скрытых работ</Typography.Title>
        <Typography.Paragraph type="secondary">Вход по логину и паролю, которые выдаёт генподрядчик. Самостоятельная регистрация не предусмотрена.</Typography.Paragraph>
        <Form layout="vertical" onFinish={async (v) => {
          setLoading(true);
          try {
            if (!(await login(v.login, v.password))) message.error('Неверный логин или пароль');
          } catch (e: any) {
            message.error(e?.message || 'Ошибка входа');
          }
          setLoading(false);
        }}>
          <Form.Item name="login" rules={[{ required: true, message: 'Введите логин' }]}>
            <Input prefix={<UserOutlined />} placeholder="Логин" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: 'Введите пароль' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="Пароль" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>Войти</Button>
        </Form>
        {SHOW_DEMO && <Divider plain style={{ fontSize: 12, color: '#5f6b78' }}>Быстрый вход для тестирования (пароль — 123)</Divider>}
        {SHOW_DEMO && <Space direction="vertical" size={6} style={{ width: '100%' }}>
          {(API_MODE ? DEMO_LOGINS.map((u) => ({ ...u, id: u.login })) : users.filter((u) => u.active)).map((u) => (
            <Button key={u.id} block disabled={loading} style={{ textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 'auto', minHeight: 36, whiteSpace: 'normal', gap: 8 }}
              onClick={async () => {
                if (!API_MODE) return loginAs(u.id);
                setLoading(true);
                try { await login(u.login, '123'); } catch (e: any) { message.error(e?.message || 'Ошибка входа'); }
                setLoading(false);
              }}>
              <span style={{ minWidth: 0 }}>{u.name} <Typography.Text type="secondary">({u.login})</Typography.Text></span>
              <Tag style={{ marginInlineEnd: 0, flexShrink: 0 }}>{ROLE_LABEL[u.role]}</Tag>
            </Button>
          ))}
        </Space>}
      </Card>
    </div>
  );
}
