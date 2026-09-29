import { useState } from 'react';
import { App as AntApp, Button, Card, Divider, Form, Input, Space, Tag, Typography } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useStore } from '../store';
import { ROLE_LABEL } from '../types';

export default function Login() {
  const login = useStore((s) => s.login);
  const loginAs = useStore((s) => s.loginAs);
  const users = useStore((s) => s.users);
  const { message } = AntApp.useApp();
  const [loading, setLoading] = useState(false);
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#e6f4ff,#f5f7fa)' }}>
      <Card style={{ width: 440 }}>
        <Typography.Title level={4} style={{ marginTop: 0 }}>Согласование актов скрытых работ</Typography.Title>
        <Typography.Paragraph type="secondary">Вход по логину и паролю, которые выдаёт генподрядчик. Регистрации нет.</Typography.Paragraph>
        <Form layout="vertical" onFinish={(v) => {
          setLoading(true);
          if (!login(v.login, v.password)) message.error('Неверный логин или пароль');
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
        <Divider plain style={{ fontSize: 12 }}>Быстрый вход (демо, пароль у всех — 123)</Divider>
        <Space direction="vertical" style={{ width: '100%' }}>
          {users.filter((u) => u.active).map((u) => (
            <Button key={u.id} block style={{ textAlign: 'left', display: 'flex', justifyContent: 'space-between' }} onClick={() => loginAs(u.id)}>
              <span>{u.name} <Typography.Text type="secondary">({u.login})</Typography.Text></span>
              <Tag>{ROLE_LABEL[u.role]}</Tag>
            </Button>
          ))}
        </Space>
      </Card>
    </div>
  );
}
