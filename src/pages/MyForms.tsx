import { useNavigate } from 'react-router-dom';
import { Button, Card, Table, Tag, Typography } from 'antd';
import { useData, useMe } from '../store';
import { FORM_STATUS } from '../types';
import { fmt, formTotalM2 } from '../logic';
import { History, fmtDate } from '../components/common';

export default function MyForms() {
  const data = useData();
  const me = useMe()!;
  const nav = useNavigate();
  const forms = data.forms.filter((f) => f.contractorId === me.contractorId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <Card title="Мои формы">
      <Table
        rowKey="id"
        dataSource={forms}
        expandable={{ expandedRowRender: (f) => <History items={f.history} /> }}
        columns={[
          {
            title: 'Объект / выполнение', render: (_, f) => {
              const ex = data.executions.find((e) => e.id === f.executionId)!;
              const o = data.objects.find((x) => x.id === ex.objectId)!;
              return <div><b>№ {o.excelRowNumber}. {o.name}</b><div><Typography.Text type="secondary">{ex.name}</Typography.Text></div></div>;
            },
          },
          { title: 'Объём, м²', align: 'right', render: (_, f) => fmt(formTotalM2(data, f)) },
          { title: 'Статус', render: (_, f) => <Tag color={FORM_STATUS[f.status].color}>{FORM_STATUS[f.status].label}</Tag> },
          { title: 'Обновлена', render: (_, f) => fmtDate(f.updatedAt) },
          {
            title: '', render: (_, f) => {
              const ex = data.executions.find((e) => e.id === f.executionId)!;
              return <Button size="small" onClick={() => nav(`/objects/${ex.objectId}?ex=${ex.id}`)}>Открыть</Button>;
            },
          },
        ]}
      />
    </Card>
  );
}
