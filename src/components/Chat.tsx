import { useEffect, useRef, useState } from 'react';
import { Button, Empty, Input, Space, Tag, Typography } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import { useData, useMe } from '../store';
import { actions } from '../actions';
import { fmtDate, useAction } from './common';
import { ROLE_LABEL } from '../types';

export default function Chat({ objectId }: { objectId: string }) {
  const data = useData();
  const me = useMe()!;
  const act = useAction();
  const [text, setText] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const msgs = data.chat.filter((m) => m.objectId === objectId);
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [msgs.length]);
  const send = async () => {
    const t = text;
    setText('');
    if (!(await act(() => actions.sendChat(objectId, t)))) setText(t);
  };
  return (
    <div>
      <div ref={box} className="chat-box">
        {msgs.length === 0 && <Empty description="Сообщений пока нет" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ margin: '12px 0' }} />}
        {msgs.map((m) => {
          const u = data.users.find((x) => x.id === m.userId);
          const mine = m.userId === me.id;
          return (
            <div key={m.id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
              <div className={`chat-msg${mine ? ' mine' : ''}`}>
                <div style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <b>{u?.name}</b>{u && <span style={{ color: '#5f6b78' }}>{ROLE_LABEL[u.role]}</span>}
                </div>
                <div style={{ whiteSpace: 'pre-wrap', margin: '2px 0' }}>{m.text}</div>
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>{fmtDate(m.at)}</Typography.Text>
              </div>
            </div>
          );
        })}
      </div>
      <div className="chat-input">
        <Input.TextArea
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoSize={{ minRows: 1, maxRows: 4 }}
          placeholder="Сообщение участникам объекта"
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <Button type="primary" icon={<SendOutlined />} onClick={send} disabled={!text.trim()} aria-label="Отправить" />
      </div>
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
        Видят все участники объекта, включая заказчика. Enter — отправить, Shift+Enter — новая строка.
      </Typography.Text>
    </div>
  );
}
