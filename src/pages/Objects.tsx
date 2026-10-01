import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useData, useMe } from '../store';
import { ACT_STATUS, FORM_STATUS, type Data, type Execution, type SiteObject, type User } from '../types';
import { STAGE, actOf, executionStage, fmt, isStaff, visibleExecutions, visibleObjects, type Stage } from '../logic';
import { allocatedM2, canManageObjects } from '../engine';
import { actions } from '../actions';
import { useAction, useGuardedClose } from '../components/common';

export const DISTRICTS = ['ЦАО', 'САО', 'СВАО', 'ВАО', 'ЮВАО', 'ЮАО', 'ЮЗАО', 'ЗАО', 'СЗАО', 'ЗелАО', 'НАО', 'ТАО'];

/** Как статус выполнения видит конкретная роль. Заказчик не видит внутренних статусов форм. */
export function ExecTag({ data, me, ex }: { data: Data; me: User; ex: Execution }) {
  const warn = ex.titleChange ? <Tag color="magenta">изменён титул</Tag> : null;
  if (me.role === 'CLIENT') {
    const act = actOf(data, ex.id);
    if (act) return <Space size={2}><Tag color={ACT_STATUS[act.status].color}>{ACT_STATUS[act.status].label}</Tag>{warn}</Space>;
    return <Tag>В работе у подрядчиков</Tag>;
  }
  const st = STAGE[executionStage(data, ex)];
  if (me.role === 'CONTRACTOR') {
    const f = data.forms.find((x) => x.executionId === ex.id && x.contractorId === me.contractorId);
    return (
      <Space size={2} wrap>
        <Tag color={st.color}>{st.label}</Tag>
        <Tag color={f ? FORM_STATUS[f.status].color : 'default'} bordered={false}>моя форма: {f ? FORM_STATUS[f.status].label : 'не заполнена'}</Tag>
        {warn}
      </Space>
    );
  }
  return <Space size={2}><Tag color={st.color}>{st.label}</Tag>{warn}</Space>;
}

export function ObjectModal({ open, onClose, obj }: { open: boolean; onClose: () => void; obj?: SiteObject }) {
  const data = useData();
  const me = useMe()!;
  const act = useAction();
  const guard = useGuardedClose();
  const [form] = Form.useForm();
  const alloc = obj ? allocatedM2(data, obj.id) : 0;
  return (
    <Modal
      open={open}
      title={obj ? 'Редактирование объекта' : 'Новый объект'}
      onCancel={() => guard(form.isFieldsTouched(), onClose)}
      okText="Сохранить"
      destroyOnClose
      onOk={() => form.validateFields().then(async (v) => {
        const ok = await act(() => actions.saveObject(obj?.id || null, v), 'Объект сохранён');
        if (ok) onClose();
      })}
    >
      <Form form={form} layout="vertical" preserve={false}
        initialValues={obj || { excelRowNumber: Math.max(0, ...data.objects.map((o) => o.excelRowNumber)) + 1, clientId: me.role === 'CLIENT' ? me.clientId : undefined }}>
        <Form.Item name="excelRowNumber" label="№ п/п (из таблицы Excel)" rules={[{ required: true }]}>
          <InputNumber decimalSeparator="," min={1} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="name" label="Наименование" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="address" label="Адрес / участок" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="district" label="Округ" rules={[{ required: true }]}>
          <Select options={DISTRICTS.map((x) => ({ value: x, label: x }))} />
        </Form.Item>
        <Form.Item name="titleM2" label="Общий объём объекта" rules={[{ required: true, message: 'Укажите объём' }]}
          extra={obj ? `Распределено по выполнениям: ${fmt(alloc)} м² — меньше этого значения указать нельзя` : 'Сумма объёмов всех выполнений не сможет превысить это значение'}>
          <InputNumber decimalSeparator="," min={obj ? alloc : 0.01} precision={2} addonAfter="м²" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="clientId" label="Заказчик" rules={[{ required: true }]}>
          <Select disabled={me.role === 'CLIENT'} options={data.clients.map((c) => ({ value: c.id, label: c.name }))} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export default function Objects() {
  const data = useData();
  const me = useMe()!;
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [district, setDistrict] = useState<string>();
  const [stage, setStage] = useState<Stage>();
  const [client, setClient] = useState<string>();
  const [modal, setModal] = useState(false);
  const staff = isStaff(me.role);
  const canManage = canManageObjects(me);

  const rows = visibleObjects(data, me)
    .filter((o) => !q || `${o.excelRowNumber} ${o.name} ${o.address}`.toLowerCase().includes(q.toLowerCase()))
    .filter((o) => !district || o.district === district)
    .filter((o) => !client || o.clientId === client)
    .filter((o) => !stage || visibleExecutions(data, me, o.id).some((e) => executionStage(data, e) === stage))
    .sort((a, b) => a.excelRowNumber - b.excelRowNumber);

  return (
    <Card
      title={me.role === 'CONTRACTOR' ? 'Мои объекты' : 'Объекты'}
      extra={canManage && <Button type="primary" icon={<PlusOutlined />} onClick={() => setModal(true)}>Добавить объект</Button>}
    >
      <Space wrap style={{ marginBottom: 16 }}>
        <Input prefix={<SearchOutlined />} placeholder="Поиск: № п/п, название, адрес" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 280 }} allowClear />
        <Select placeholder="Округ" allowClear style={{ width: 120 }} value={district} onChange={setDistrict}
          options={[...new Set(data.objects.map((o) => o.district))].map((x) => ({ value: x, label: x }))} />
        {me.role !== 'CLIENT' && (
          <Select placeholder="Статус выполнения" allowClear style={{ width: 240 }} value={stage} onChange={setStage}
            options={(Object.keys(STAGE) as Stage[]).map((k) => ({ value: k, label: STAGE[k].label }))} />
        )}
        {staff && (
          <Select placeholder="Заказчик" allowClear style={{ width: 260 }} value={client} onChange={setClient}
            options={data.clients.map((c) => ({ value: c.id, label: c.name }))} />
        )}
      </Space>
      <Table
        rowKey="id"
        dataSource={rows}
        locale={{ emptyText: q || district || client ? 'Ничего не найдено — измените условия фильтра' : canManage ? 'Объектов пока нет. Нажмите «Добавить объект».' : 'Объектов пока нет' }}
        pagination={{ pageSize: 20 }}
        onRow={(o) => ({ onClick: () => nav(`/objects/${o.id}`), style: { cursor: 'pointer' } })}
        columns={[
          { title: '№', dataIndex: 'excelRowNumber', width: 64 },
          {
            title: 'Объект', render: (_, o) => (
              <div>
                <b>{o.name}</b>
                <div><Typography.Text type="secondary">{o.address}</Typography.Text></div>
              </div>
            ),
          },
          { title: 'Округ', dataIndex: 'district', width: 80 },
          {
            title: 'Объём, м²', width: 150, render: (_, o) => {
              const alloc = allocatedM2(data, o.id);
              return <div><b>{fmt(o.titleM2)}</b><div><Typography.Text type="secondary" style={{ fontSize: 12 }}>в выполнениях: {fmt(alloc)}</Typography.Text></div></div>;
            },
          },
          ...(me.role !== 'CLIENT' ? [{ title: 'Заказчик', render: (_: any, o: SiteObject) => data.clients.find((c) => c.id === o.clientId)?.name }] : []),
          {
            title: 'Выполнения', render: (_, o) => (
              <Space direction="vertical" size={2}>
                {visibleExecutions(data, me, o.id).map((e) => (
                  <div key={e.id}>
                    <Typography.Text style={{ marginRight: 6 }}>{e.name} · {fmt(e.titleM2)} м²</Typography.Text>
                    <ExecTag data={data} me={me} ex={e} />
                  </div>
                ))}
              </Space>
            ),
          },
        ]}
      />
      <ObjectModal open={modal} onClose={() => setModal(false)} />
    </Card>
  );
}
