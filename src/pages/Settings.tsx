import { useState } from 'react';
import { Alert, Button, Card, Descriptions, Input, Space, Steps, Tag, Typography } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import { useMe } from '../store';
import { ROLE_LABEL } from '../types';
import { nowIso } from '../engine';
import { useAction } from '../components/common';

export default function Settings() {
  const me = useMe()!;
  const act = useAction();
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const upd = (fn: (u: any) => void, msg: string) => act((d) => fn(d.users.find((u) => u.id === me.id)!), msg);

  return (
    <Space direction="vertical" style={{ width: '100%', maxWidth: 800 }} size={16}>
      <Card title="Профиль">
        <Descriptions column={1} size="small">
          <Descriptions.Item label="ФИО">{me.name}</Descriptions.Item>
          <Descriptions.Item label="Логин">{me.login}</Descriptions.Item>
          <Descriptions.Item label="Роль">{ROLE_LABEL[me.role]}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title={<span><SendOutlined /> Привязка Telegram</span>}>
        {me.role === 'CLIENT' ? (
          <Alert type="info" showIcon message="Уведомления в Telegram для заказчика появятся позже. Сейчас уведомления видны в разделе «Уведомления»." />
        ) : me.telegramChatId ? (
          <Space direction="vertical">
            <div>Статус: <Tag color="green">привязан</Tag> chat_id: <code>{me.telegramChatId}</code></div>
            <Button danger onClick={() => upd((u) => { u.telegramChatId = null; u.telegramToken = null; }, 'Telegram отвязан')}>Отвязать</Button>
          </Space>
        ) : (
          <>
            <Steps size="small" direction="vertical" current={me.telegramToken ? 1 : 0} items={[
              { title: 'Получите токен привязки', description: me.telegramToken ? <span>Токен: <Typography.Text code copyable>{me.telegramToken}</Typography.Text></span> : <Button onClick={() => upd((u) => { u.telegramToken = Math.random().toString(36).slice(2, 8).toUpperCase(); }, 'Токен создан')}>Получить токен</Button> },
              { title: 'Отправьте боту команду', description: me.telegramToken && <span>Откройте бота и отправьте <code>/start {me.telegramToken}</code></span> },
              { title: 'Готово', description: me.telegramToken && <Button type="primary" onClick={() => upd((u) => { u.telegramChatId = String(100000 + Math.floor(Math.random() * 899999)); u.telegramToken = null; }, 'Telegram привязан (имитация)')}>Имитировать подтверждение ботом</Button> },
            ]} />
          </>
        )}
      </Card>

      <Card title="Смена пароля">
        <Typography.Paragraph type="secondary">После смены пароля все старые сессии (JWT) перестают действовать.</Typography.Paragraph>
        <Space wrap>
          <Input.Password placeholder="Новый пароль" value={p1} onChange={(e) => setP1(e.target.value)} />
          <Input.Password placeholder="Повторите" value={p2} onChange={(e) => setP2(e.target.value)} />
          <Button type="primary" disabled={!p1 || p1 !== p2} onClick={() => {
            act((d) => { const u = d.users.find((x) => x.id === me.id)!; u.password = p1; u.passwordChangedAt = nowIso(d); }, 'Пароль изменён');
            setP1(''); setP2('');
          }}>Сменить</Button>
        </Space>
      </Card>
    </Space>
  );
}
