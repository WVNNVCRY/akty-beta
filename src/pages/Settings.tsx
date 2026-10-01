import { useState } from 'react';
import { Alert, Button, Card, Descriptions, Input, Space, Steps, Tag, Typography } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import { useMe, useStore } from '../store';
import { ROLE_LABEL } from '../types';
import { useAction } from '../components/common';
import { actions } from '../actions';
import { API_MODE } from '../api';

export default function Settings() {
  const me = useMe()!;
  const act = useAction();
  const run = useStore((s) => s.run);
  const [old, setOld] = useState('');
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [code, setCode] = useState<{ code: string; botEnabled: boolean } | null>(null);
  const shownCode = API_MODE ? code?.code : me.telegramToken;

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
            <div>Статус: <Tag color="green">привязан</Tag>{!API_MODE && <>chat_id: <code>{me.telegramChatId}</code></>}</div>
            <Button danger onClick={() => act(() => actions.telegramUnlink(), 'Telegram отвязан')}>Отвязать</Button>
          </Space>
        ) : (
          <>
            <Steps size="small" direction="vertical" current={shownCode ? 1 : 0} items={[
              {
                title: 'Получите код привязки',
                description: shownCode
                  ? <span>Код: <Typography.Text code copyable>{shownCode}</Typography.Text>{API_MODE && ' (действует 15 минут)'}</span>
                  : <Button onClick={() => act(async () => setCode(await actions.telegramCode()), 'Код создан')}>Получить код</Button>,
              },
              { title: 'Отправьте боту команду', description: shownCode && <span>Откройте бота системы и отправьте <code>/start {shownCode}</code></span> },
              {
                title: 'Готово',
                description: shownCode && (API_MODE
                  ? <span>
                      После подтверждения ботом обновите страницу — статус сменится на «привязан».
                      {code && !code.botEnabled && <Alert style={{ marginTop: 8 }} type="warning" showIcon message="На этом сервере бот ещё не подключён (не задан TELEGRAM_BOT_TOKEN)." />}
                    </span>
                  : <Button type="primary" onClick={() => act(() => run((d) => {
                      const u = d.users.find((x) => x.id === me.id)!;
                      u.telegramChatId = String(100000 + Math.floor(Math.random() * 899999));
                      u.telegramToken = null;
                    }), 'Telegram привязан (имитация)')}>Имитировать подтверждение ботом</Button>),
              },
            ]} />
          </>
        )}
      </Card>

      <Card title="Смена пароля">
        <Typography.Paragraph type="secondary">После смены пароля сеансы на других устройствах завершаются.</Typography.Paragraph>
        <Space wrap>
          <Input.Password placeholder="Текущий пароль" value={old} onChange={(e) => setOld(e.target.value)} />
          <Input.Password placeholder="Новый пароль" value={p1} onChange={(e) => setP1(e.target.value)} />
          <Input.Password placeholder="Повторите новый пароль" value={p2} onChange={(e) => setP2(e.target.value)} status={p2 && p1 !== p2 ? 'error' : undefined} />
          <Button type="primary" disabled={!old || !p1 || p1 !== p2} onClick={async () => {
            if (await act(() => actions.changePassword(old, p1), 'Пароль изменён')) { setOld(''); setP1(''); setP2(''); }
          }}>Сменить пароль</Button>
        </Space>
        {API_MODE && <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>Не менее 6 символов.</Typography.Paragraph>}
      </Card>
    </Space>
  );
}
