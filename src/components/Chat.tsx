import { useEffect, useRef, useState } from 'react';
import { Button, Empty, Input, Space, Tag, Typography } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import { useData, useMe } from '../store';
import { sendChat } from '../engine';
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
  const send = () => {
    act((d, uid) => sendChat(d, uid, objectId, text));
    setText('');
  };
  return (
    <div>
      <div ref={box} style={{ maxHeight: 380, overflowY: 'auto', padding: 8, background: '#fafafa', borderRadius: 8, marginBottom: 8 }}>
        {msgs.length === 0 && <Empty description="Сообщений пока нет" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
        {msgs.map((m) => {
          const u = data.users.find((x) => x.id === m.userId);
          const mine = m.userId === me.id;
          return (
            <div key={m.id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
              <div style={{ maxWidth: '80%', background: mine ? '#e6f4ff' : '#fff', border: '1px solid #f0f0f0', borderRadius: 8, padding: '6px 10px' }}>
                <div style={{ fontSize: 12 }}>
                  <b>{u?.name}</b> {u && <Tag style={{ fontSize: 10, marginLeft: 4 }}>{ROLE_LABEL[u.role]}</Tag>}
                </div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>{fmtDate(m.at)}</Typography.Text>
              </div>
            </div>
          );
        })}
      </div>
      <Space.Compact style={{ width: '100%' }}>
        <Input.TextArea
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoSize={{ minRows: 1, maxRows: 4 }}
          placeholder="Сообщение в чат объекта (видят все участники, включая заказчика)"
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <Button type="primary" icon={<SendOutlined />} onClick={send} disabled={!text.trim()} />
      </Space.Compact>
    </div>
  );
}
