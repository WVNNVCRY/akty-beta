import { useState } from 'react';
import { Card, Input, Select, Space, Typography } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useData, useMe } from '../store';
import { isStaff, visibleActs } from '../logic';
import { ActsTable } from './Acts';

export default function Archive() {
  const data = useData();
  const me = useMe()!;
  const [q, setQ] = useState('');
  const [district, setDistrict] = useState<string>();
  const [client, setClient] = useState<string>();
  const acts = visibleActs(data, me)
    .filter((a) => a.status === 'ARCHIVED')
    .filter((a) => {
      const o = data.objects.find((x) => x.id === a.objectId)!;
      if (district && o.district !== district) return false;
      if (client && o.clientId !== client) return false;
      return !q || `${a.number} ${o.excelRowNumber} ${o.name} ${o.address}`.toLowerCase().includes(q.toLowerCase());
    });
  return (
    <Card title="Архив актов">
      <Typography.Paragraph type="secondary">
        {me.role === 'CONTRACTOR' ? 'Акты по вашим объектам. Доступны просмотр и выгрузка своих документов, без редактирования.'
          : me.role === 'CLIENT' ? 'Просмотр и выгрузка документов, без редактирования.'
            : 'Все архивные акты. Изменения после согласования — только ГП через «Корректировку» в карточке акта.'}
      </Typography.Paragraph>
      <Space wrap style={{ marginBottom: 16 }}>
        <Input prefix={<SearchOutlined />} placeholder="Поиск: № акта, № п/п, объект, адрес" value={q} onChange={(e) => setQ(e.target.value)} allowClear style={{ width: 300 }} />
        <Select placeholder="Округ" allowClear style={{ width: 120 }} value={district} onChange={setDistrict}
          options={[...new Set(data.objects.map((o) => o.district))].map((x) => ({ value: x, label: x }))} />
        {isStaff(me.role) && <Select placeholder="Заказчик" allowClear style={{ width: 260 }} value={client} onChange={setClient}
          options={data.clients.map((c) => ({ value: c.id, label: c.name }))} />}
      </Space>
      <ActsTable acts={acts} />
    </Card>
  );
}
