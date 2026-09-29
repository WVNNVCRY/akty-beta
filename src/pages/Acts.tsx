import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Input, Select, Space, Table, Tag, Typography } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useData, useMe } from '../store';
import { ACT_STATUS, type Act, type ActStatus, type Data } from '../types';
import { fmt, isStaff, lineM2, visibleActs } from '../logic';
import { fmtDate } from '../components/common';

export const actTotal = (d: Data, a: Act) => a.rows.reduce((s, r) => s + r.lines.reduce((ss, l) => ss + lineM2(d, l), 0), 0);

export function ActsTable({ acts, compact }: { acts: Act[]; compact?: boolean }) {
  const data = useData();
  const nav = useNavigate();
  return (
    <Table
      rowKey="id"
      dataSource={[...acts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))}
      onRow={(a) => ({ onClick: () => nav(`/acts/${a.id}`), style: { cursor: 'pointer' } })}
      pagination={compact ? false : { pageSize: 20 }}
      size={compact ? 'small' : undefined}
      scroll={{ x: true }}
      columns={[
        { title: '№ акта', dataIndex: 'number', width: 110 },
        {
          title: 'Объект', render: (_, a) => {
            const o = data.objects.find((x) => x.id === a.objectId)!;
            const ex = data.executions.find((x) => x.id === a.executionId);
            return <div><b>№ {o.excelRowNumber}. {o.name}</b><div><Typography.Text type="secondary">{ex?.name} · {o.district}</Typography.Text></div></div>;
          },
        },
        ...(compact ? [] : [{ title: 'Заказчик', render: (_: any, a: Act) => data.clients.find((c) => c.id === data.objects.find((o) => o.id === a.objectId)?.clientId)?.name }]),
        { title: 'Объём, м²', align: 'right', render: (_, a) => fmt(actTotal(data, a)) },
        { title: 'Статус', render: (_, a) => <Tag color={ACT_STATUS[a.status].color}>{ACT_STATUS[a.status].label}</Tag> },
        ...(compact ? [] : [{ title: 'Обновлён', render: (_: any, a: Act) => fmtDate(a.updatedAt), width: 150 }]),
      ]}
    />
  );
}

export default function Acts() {
  const data = useData();
  const me = useMe()!;
  const [status, setStatus] = useState<ActStatus | undefined>(me.role === 'CLIENT' ? 'ON_CHECK_CLIENT' : undefined);
  const [client, setClient] = useState<string>();
  const [q, setQ] = useState('');
  const acts = visibleActs(data, me)
    .filter((a) => !status || a.status === status)
    .filter((a) => !client || data.objects.find((o) => o.id === a.objectId)?.clientId === client)
    .filter((a) => {
      if (!q) return true;
      const o = data.objects.find((x) => x.id === a.objectId)!;
      return `${a.number} ${o.excelRowNumber} ${o.name} ${o.address}`.toLowerCase().includes(q.toLowerCase());
    });
  return (
    <Card title={me.role === 'CLIENT' ? 'Акты' : 'Все акты'}>
      <Space wrap style={{ marginBottom: 16 }}>
        <Input prefix={<SearchOutlined />} placeholder="Поиск" value={q} onChange={(e) => setQ(e.target.value)} allowClear style={{ width: 240 }} />
        <Select placeholder="Статус" allowClear style={{ width: 220 }} value={status} onChange={setStatus}
          options={(Object.keys(ACT_STATUS) as ActStatus[]).map((k) => ({ value: k, label: ACT_STATUS[k].label }))} />
        {isStaff(me.role) && (
          <Select placeholder="Заказчик" allowClear style={{ width: 260 }} value={client} onChange={setClient}
            options={data.clients.map((c) => ({ value: c.id, label: c.name }))} />
        )}
      </Space>
      <ActsTable acts={acts} />
    </Card>
  );
}
