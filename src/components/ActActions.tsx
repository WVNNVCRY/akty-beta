import { useState } from 'react';
import { App as AntApp, Button, Checkbox, Input, Modal, Popconfirm, Space, Typography } from 'antd';
import { CheckOutlined, FileWordOutlined, InboxOutlined, RollbackOutlined } from '@ant-design/icons';
import { useData, useMe } from '../store';
import type { Act, Data } from '../types';
import { isStaff } from '../logic';
import { archiveAct, downloadWordLog, gcApproveAct, gcReturnAct } from '../engine';
import { downloadBlob, makeEmptyDocx } from '../files';
import { useAction, useGuardedClose } from './common';

const cName = (d: Data, id: string) => d.contractors.find((c) => c.id === id)?.name || '—';

export async function downloadWord(data: Data, act: Act) {
  const obj = data.objects.find((o) => o.id === act.objectId)!;
  await downloadBlob(await makeEmptyDocx(), `${act.number}_№${obj.excelRowNumber}.docx`);
}

/** Кнопки по акту: согласование ГП, возврат, Word, архив. Используются в карточке объекта и акта. */
export default function ActActions({ act, size }: { act: Act; size?: 'small' | 'middle' }) {
  const data = useData();
  const me = useMe()!;
  const run = useAction();
  const { modal } = AntApp.useApp();
  const [ret, setRet] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const guard = useGuardedClose();
  const staff = isStaff(me.role);
  const done = ['APPROVED', 'ARCHIVED'].includes(act.status);

  return (
    <Space wrap>
      {staff && act.status === 'ON_CHECK_GC' && (
        <Button size={size} type="primary" icon={<CheckOutlined />} onClick={() => modal.confirm({
          title: `Согласовать акт ${act.number}?`, content: 'Заказчик уже одобрил все формы. После согласования акт можно выгрузить в Word и отправить в архив.',
          okText: 'Согласовать', onOk: () => { run((d, u) => gcApproveAct(d, u, act.id), 'Акт согласован'); },
        })}>Согласовать акт</Button>
      )}
      {staff && act.status === 'ON_CHECK_GC' && (
        <Button size={size} danger icon={<RollbackOutlined />} onClick={() => { setSel(act.rows.map((r) => r.contractorId)); setRet(true); }}>Вернуть на доработку</Button>
      )}
      {(staff || me.role === 'CLIENT') && done && (
        <Button size={size} icon={<FileWordOutlined />} onClick={async () => {
          run((d, u) => downloadWordLog(d, u, act.id));
          await downloadWord(data, act);
        }}>Скачать Word</Button>
      )}
      {staff && act.status === 'APPROVED' && (
        <Popconfirm title={`Отправить акт ${act.number} в архив?`} description="Редактирование будет доступно только ГП через корректировку."
          onConfirm={() => run((d, u) => archiveAct(d, u, act.id), 'Акт отправлен в архив')}>
          <Button size={size} icon={<InboxOutlined />}>В архив</Button>
        </Popconfirm>
      )}
      <Modal open={ret} title={`Вернуть акт ${act.number} на доработку`} okText="Вернуть" okButtonProps={{ danger: true, disabled: !comment.trim() || !sel.length }}
        onCancel={() => guard(!!comment.trim(), () => { setRet(false); setComment(''); })}
        onOk={() => {
          run((d, u) => gcReturnAct(d, u, act.id, sel, comment), 'Акт возвращён на доработку');
          setRet(false);
          setComment('');
        }}>
        <Typography.Paragraph type="secondary">
          Выбранные формы вернутся подрядчикам. После исправления они снова пройдут согласование у заказчика, а затем акт вернётся к вам.
          Комментарий видят подрядчики, заказчик — нет.
        </Typography.Paragraph>
        <Checkbox.Group value={sel} onChange={(v) => setSel(v as string[])} style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}
          options={act.rows.map((r) => ({ value: r.contractorId, label: cName(data, r.contractorId) + (r.autoZero ? ' (автоформа с нулями)' : '') }))} />
        <Input.TextArea rows={4} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Что нужно исправить" />
      </Modal>
    </Space>
  );
}
