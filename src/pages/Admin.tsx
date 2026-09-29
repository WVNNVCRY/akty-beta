import { useState, type ReactNode } from 'react';
import { Alert, Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tabs, Tag } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useData } from '../store';
import { ROLE_LABEL, type Data, type Role } from '../types';
import { fmt } from '../logic';
import { nowIso, uid } from '../engine';
import { useAction, useGuardedClose } from '../components/common';

type Coll = 'users' | 'contractors' | 'clients' | 'markingTypes';

interface Field { name: string; label: string; input: ReactNode; required?: boolean; show?: (v: any) => boolean }

function Crud({ coll, columns, fields, canDelete, defaults, normalize }: {
  coll: Coll; columns: any[]; fields: Field[]; canDelete?: (d: Data, row: any) => string | null; defaults?: any; normalize?: (v: any, d: Data, row?: any) => void;
}) {
  const data = useData();
  const act = useAction();
  const [form] = Form.useForm();
  const [edit, setEdit] = useState<any | null>(null);
  const guard = useGuardedClose();
  const values = Form.useWatch([], form) || {};
  const rows = data[coll] as any[];
  return (
    <>
      <Button type="primary" icon={<PlusOutlined />} style={{ marginBottom: 12 }} onClick={() => setEdit({})}>Добавить</Button>
      <Table
        rowKey="id" size="small" dataSource={rows} pagination={false}
        columns={[...columns, {
          title: '', width: 100, render: (_: any, r: any) => (
            <Space>
              <Button size="small" icon={<EditOutlined />} onClick={() => setEdit(r)} />
              {canDelete && (
                <Popconfirm title="Удалить?" onConfirm={() => act((d) => {
                  const why = canDelete(d, r);
                  if (why) throw new Error(why);
                  (d as any)[coll] = (d as any)[coll].filter((x: any) => x.id !== r.id);
                }, 'Удалено')}>
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              )}
            </Space>
          ),
        }]}
      />
      <Modal
        open={!!edit} destroyOnClose title={edit?.id ? 'Редактирование' : 'Создание'} okText="Сохранить" onCancel={() => guard(form.isFieldsTouched(), () => setEdit(null))}
        onOk={() => form.validateFields().then((v) => {
          const ok = act((d) => {
            normalize?.(v, d, edit?.id ? edit : undefined);
            const list = (d as any)[coll] as any[];
            if (edit?.id) Object.assign(list.find((x) => x.id === edit.id), v);
            else list.push({ id: uid(), ...(defaults ? defaults(d) : {}), ...v });
            return true;
          }, 'Сохранено');
          if (ok) setEdit(null);
        })}
      >
        <Form form={form} layout="vertical" preserve={false} initialValues={edit || {}}>
          {fields.filter((f) => !f.show || f.show({ ...edit, ...values })).map((f) => (
            <Form.Item key={f.name} name={f.name} label={f.label} rules={f.required ? [{ required: true, message: 'Обязательное поле' }] : []} valuePropName={f.name === 'active' ? 'checked' : 'value'}>
              {f.input}
            </Form.Item>
          ))}
        </Form>
      </Modal>
    </>
  );
}

export default function Admin() {
  const data = useData();
  const act = useAction();
  const s = data.settings;
  const cName = (id?: string | null) => data.contractors.find((c) => c.id === id)?.name;
  const clName = (id?: string | null) => data.clients.find((c) => c.id === id)?.name;

  return (
    <Card title="Админка (только генподрядчик)">
      <Tabs items={[
        {
          key: 'users', label: 'Пользователи', children: (
            <Crud
              coll="users"
              defaults={(d: Data) => ({ passwordChangedAt: nowIso(d), telegramChatId: null })}
              normalize={(v, d, row) => {
                if (d.users.some((u) => u.login === v.login && u.id !== row?.id)) throw new Error('Логин занят');
                if (v.role === 'CONTRACTOR' && !v.contractorId) throw new Error('Для подрядчика выберите организацию');
                if (v.role === 'CLIENT' && !v.clientId) throw new Error('Для заказчика выберите организацию');
                if (v.role !== 'CONTRACTOR') v.contractorId = null;
                if (v.role !== 'CLIENT') v.clientId = null;
                if (row && row.password !== v.password) v.passwordChangedAt = nowIso(d);
                if (v.active === undefined) v.active = true;
              }}
              columns={[
                { title: 'ФИО', dataIndex: 'name' },
                { title: 'Логин', dataIndex: 'login' },
                { title: 'Роль', render: (_: any, u: any) => <Tag>{ROLE_LABEL[u.role as Role]}</Tag> },
                { title: 'Организация', render: (_: any, u: any) => cName(u.contractorId) || clName(u.clientId) || '—' },
                { title: 'Telegram', render: (_: any, u: any) => (u.telegramChatId ? <Tag color="blue">привязан</Tag> : '—') },
                { title: 'Активен', render: (_: any, u: any) => (u.active ? <Tag color="green">да</Tag> : <Tag>нет</Tag>) },
              ]}
              fields={[
                { name: 'name', label: 'ФИО', input: <Input />, required: true },
                { name: 'login', label: 'Логин', input: <Input />, required: true },
                { name: 'password', label: 'Пароль (смена пароля завершает старые сессии)', input: <Input />, required: true },
                { name: 'role', label: 'Роль', required: true, input: <Select options={(Object.keys(ROLE_LABEL) as Role[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }))} /> },
                { name: 'contractorId', label: 'Подрядчик', show: (v) => v.role === 'CONTRACTOR', input: <Select options={data.contractors.map((c) => ({ value: c.id, label: c.name }))} /> },
                { name: 'clientId', label: 'Заказчик', show: (v) => v.role === 'CLIENT', input: <Select options={data.clients.map((c) => ({ value: c.id, label: c.name }))} /> },
                { name: 'active', label: 'Активен', input: <Switch /> },
              ]}
            />
          ),
        },
        {
          key: 'contractors', label: 'Подрядчики', children: (
            <Crud
              coll="contractors"
              canDelete={(d, r) => (d.executions.some((e) => e.contractorIds.includes(r.id)) || d.users.some((u) => u.contractorId === r.id) ? 'Подрядчик назначен на выполнения или у него есть пользователи' : null)}
              columns={[
                { title: 'Название', dataIndex: 'name' },
                { title: 'Специализация', dataIndex: 'specialization' },
                { title: 'Назначений', render: (_: any, c: any) => data.executions.filter((e) => e.contractorIds.includes(c.id)).length },
              ]}
              fields={[
                { name: 'name', label: 'Название', input: <Input />, required: true },
                { name: 'specialization', label: 'Специализация', required: true, input: <Select options={['Механика', 'Ручка', 'Другое'].map((x) => ({ value: x, label: x }))} /> },
              ]}
            />
          ),
        },
        {
          key: 'clients', label: 'Заказчики', children: (
            <Crud
              coll="clients"
              canDelete={(d, r) => (d.objects.some((o) => o.clientId === r.id) ? 'У заказчика есть объекты' : null)}
              columns={[{ title: 'Название', dataIndex: 'name' }, { title: 'Объектов', render: (_: any, c: any) => data.objects.filter((o) => o.clientId === c.id).length }]}
              fields={[{ name: 'name', label: 'Название', input: <Input />, required: true }]}
            />
          ),
        },
        {
          key: 'mt', label: 'Виды разметки', children: (
            <>
              <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Коэффициенты перевода п.м → м² демонстрационные (ширина линии × доля заполнения). Уточните по вашим нормативам."
                description="Изменение коэффициента влияет на пересчёт всех форм, включая уже поданные." />
              <Crud
                coll="markingTypes"
                canDelete={(d, r) => (d.forms.some((f) => f.lines.some((l) => l.markingTypeId === r.id)) ? 'Вид разметки используется в формах подрядчиков' : null)}
                columns={[
                  { title: 'Код', dataIndex: 'code', width: 80 },
                  { title: 'Название', dataIndex: 'name' },
                  { title: 'Ширина, м', dataIndex: 'widthM' },
                  { title: 'Доля заполнения', dataIndex: 'fillRatio' },
                  { title: 'м² на 1 п.м', render: (_: any, m: any) => <b>{fmt(m.widthM * m.fillRatio)}</b> },
                ]}
                fields={[
                  { name: 'code', label: 'Код (ГОСТ)', input: <Input />, required: true },
                  { name: 'name', label: 'Название', input: <Input />, required: true },
                  { name: 'widthM', label: 'Ширина линии, м', input: <InputNumber min={0} step={0.05} style={{ width: '100%' }} />, required: true },
                  { name: 'fillRatio', label: 'Доля заполнения (1 — сплошная, 0.25 — штрих 1:3)', input: <InputNumber min={0} max={1} step={0.05} style={{ width: '100%' }} />, required: true },
                ]}
              />
            </>
          ),
        },
        {
          key: 'settings', label: 'Настройки', children: (
            <Form layout="vertical" style={{ maxWidth: 420 }} initialValues={s}
              onFinish={(v) => act((d) => { d.settings = { ...d.settings, ...v }; }, 'Настройки сохранены')}>
              <Form.Item name="remindFirstDays" label="Первое напоминание (недостача), дней"><InputNumber min={1} /></Form.Item>
              <Form.Item name="remindSecondDays" label="Второе напоминание (требуется вмешательство), дней"><InputNumber min={1} /></Form.Item>
              <Form.Item name="toleranceM2" label="Допуск при сверке с титулом, м²" extra="0 — строгое равенство, как в ТЗ">
                <InputNumber min={0} step={0.1} />
              </Form.Item>
              <Button type="primary" htmlType="submit">Сохранить</Button>
            </Form>
          ),
        },
      ]} />
    </Card>
  );
}
