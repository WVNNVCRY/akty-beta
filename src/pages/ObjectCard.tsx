import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Alert, App as AntApp, Badge, Button, Card, Col, Collapse, DatePicker, Descriptions, Empty, Form, Input, InputNumber, Modal,
  Popconfirm, Progress, Row, Select, Space, Table, Tabs, Tag, Typography, Upload,
} from 'antd';
import {
  ArrowLeftOutlined, CheckOutlined, CloseOutlined, DeleteOutlined, EditOutlined, InboxOutlined, PlusOutlined,
  RollbackOutlined, SaveOutlined, SendOutlined, UploadOutlined, WarningOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useData, useMe } from '../store';
import {
  ACT_STATUS, FORM_STATUS, clientFormStatus, type ContractorForm, type Data, type Execution, type FileRef, type FormLine, type User,
} from '../types';
import {
  COUNTED, EDITABLE, actLocked, actOf, coef, executionBalance, executionJournal, fmt, formTotalM2, isStaff, lineM2, linesM2,
  round2, visibleExecutions, visibleObjects,
} from '../logic';
import {
  allocatedM2, archiveAct, canManageObjects, clientApproveForm, clientRejectForm, deleteExecution, deleteObject, saveExecution, saveForm,
  submitForm, uid, withdrawForm,
} from '../engine';
import { putFile } from '../files';
import { FileLink, History, fmtDate, fmtDay, useAction, useGuardedClose, userName } from '../components/common';
import Chat from '../components/Chat';
import ActActions from '../components/ActActions';
import { ExecTag, ObjectModal } from './Objects';

const cName = (d: Data, id: string) => d.contractors.find((c) => c.id === id)?.name || '—';
const mtCode = (d: Data, id: string) => d.markingTypes.find((m) => m.id === id)?.code || '—';

function formStatusTag(me: User, f?: ContractorForm) {
  if (!f) return <Tag>нет формы</Tag>;
  const s = me.role === 'CLIENT' ? clientFormStatus(f.status) : FORM_STATUS[f.status];
  return (
    <Space size={2}>
      <Tag color={s.color}>{s.label}</Tag>
      {f.autoZero && <Tag color="cyan">авто, 0 м²</Tag>}
    </Space>
  );
}

// ---------------- Баннер изменения титула ----------------

function TitleChangeBanner({ ex }: { ex: Execution }) {
  const data = useData();
  const tc = ex.titleChange;
  if (!tc) return null;
  return (
    <Alert
      type="error" showIcon icon={<WarningOutlined />} style={{ marginTop: 12, borderColor: '#ff85c0', background: '#fff0f6' }}
      message={<b>Изменён титульный объём: {fmt(tc.from)} → {fmt(tc.to)} м² ({tc.to > tc.from ? '+' : ''}{fmt(tc.to - tc.from)} м²)</b>}
      description={
        <div>
          <div>{fmtDate(tc.at)} · {userName(data, tc.userId)}</div>
          {tc.reason && <div>Причина: {tc.reason}</div>}
          <div style={{ marginTop: 4 }}>Все поданные формы (включая одобренные заказчиком) возвращены подрядчикам на пересчёт. После повторной подачи акт снова пройдёт заказчика и ГП.</div>
        </div>
      }
    />
  );
}

// ---------------- Сводка объёмов ----------------

function VolumesTable({ ex }: { ex: Execution }) {
  const data = useData();
  const me = useMe()!;
  const bal = executionBalance(data, ex);
  const tol = data.settings.toleranceM2;
  const rows = ex.contractorIds.map((cid) => {
    const f = data.forms.find((x) => x.executionId === ex.id && x.contractorId === cid);
    const counted = !!f && COUNTED.includes(f.status);
    // заказчик не видит черновики; подрядчик видит свой черновик
    const showLines = !!f && (counted || (me.role === 'CONTRACTOR' && cid === me.contractorId) || isStaff(me.role));
    return { cid, f, counted, showLines };
  });
  const pct = ex.titleM2 ? Math.min(100, Math.round((bal.submitted / ex.titleM2) * 100)) : 0;
  const ok = Math.abs(bal.diff) <= tol + 1e-9;
  return (
    <>
      <Row gutter={16} align="middle" style={{ marginBottom: 8 }}>
        <Col flex="auto">
          <Progress percent={pct} status={bal.diff > tol ? 'exception' : ok ? 'success' : 'active'}
            format={() => `${fmt(bal.submitted)} / ${fmt(ex.titleM2)} м²`} />
        </Col>
        <Col>
          {ok ? <Tag color="green">сошлось с титулом</Tag>
            : bal.diff < 0 ? <Tag color="gold">недостача {fmt(-bal.diff)} м²</Tag> : <Tag color="red">перебор {fmt(bal.diff)} м²</Tag>}
        </Col>
      </Row>
      <Table
        size="small" bordered pagination={false} rowKey="cid" dataSource={rows}
        columns={[
          { title: 'Подрядчик', render: (_, r) => <b>{cName(data, r.cid)}</b> },
          { title: 'Статус формы', render: (_, r) => formStatusTag(me, me.role === 'CLIENT' && r.f && !COUNTED.includes(r.f.status) && !actOf(data, ex.id) ? undefined : r.f) },
          {
            title: 'Разметка (п.м → м²)', render: (_, r) => !r.showLines ? '—' : r.f!.lines.length === 0 ? <Typography.Text type="secondary">нулевой объём</Typography.Text> : (
              <Space size={[4, 4]} wrap>
                {r.f!.lines.map((l) => <Tag key={l.markingTypeId} bordered={false}>{mtCode(data, l.markingTypeId)}: {fmt(l.linearM)} п.м → {fmt(lineM2(data, l))} м²</Tag>)}
              </Space>
            ),
          },
          {
            title: 'Итого, м²', align: 'right', width: 110,
            render: (_, r) => !r.showLines ? '—' : r.counted ? <b>{fmt(formTotalM2(data, r.f!))}</b> : <Typography.Text type="secondary">{fmt(formTotalM2(data, r.f!))} (не подана)</Typography.Text>,
          },
        ]}
        summary={() => (
          <>
            <Table.Summary.Row style={{ background: '#fafafa' }}>
              <Table.Summary.Cell index={0} colSpan={3} align="right">Подано (учитывается в сверке)</Table.Summary.Cell>
              <Table.Summary.Cell index={3} align="right"><b>{fmt(bal.submitted)}</b></Table.Summary.Cell>
            </Table.Summary.Row>
            <Table.Summary.Row style={{ background: '#fafafa' }}>
              <Table.Summary.Cell index={0} colSpan={3} align="right">Титул</Table.Summary.Cell>
              <Table.Summary.Cell index={3} align="right"><b>{fmt(ex.titleM2)}</b></Table.Summary.Cell>
            </Table.Summary.Row>
          </>
        )}
      />
    </>
  );
}

// ---------------- Форма подрядчика ----------------

function UploadPdf({ value, onChange, disabled, label }: { value?: FileRef | null; onChange: (f: FileRef | null) => void; disabled: boolean; label: string }) {
  const me = useMe()!;
  const { message } = AntApp.useApp();
  return (
    <Space wrap>
      <Typography.Text strong>{label}:</Typography.Text>
      {value ? <FileLink file={value} /> : <Typography.Text type="danger">не загружен</Typography.Text>}
      {!disabled && (
        <Upload
          accept="application/pdf,.pdf"
          showUploadList={false}
          beforeUpload={async (file) => {
            if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
              message.error('Нужен файл в формате PDF');
              return Upload.LIST_IGNORE;
            }
            if (file.size > 30 * 1024 * 1024) {
              message.error('Файл больше 30 МБ');
              return Upload.LIST_IGNORE;
            }
            const id = uid();
            await putFile(id, file);
            onChange({ id, name: file.name, size: file.size, uploadedAt: new Date().toISOString(), uploadedBy: me.id });
            message.success(`Загружен: ${file.name}`);
            return false;
          }}
        >
          <Button size="small" icon={<UploadOutlined />}>{value ? 'Заменить' : 'Загрузить PDF'}</Button>
        </Upload>
      )}
    </Space>
  );
}

interface EditLine extends FormLine { key: string }

function ContractorFormEditor({ ex }: { ex: Execution }) {
  const data = useData();
  const me = useMe()!;
  const act = useAction();
  const form = data.forms.find((f) => f.executionId === ex.id && f.contractorId === me.contractorId);
  const exAct = actOf(data, ex.id);
  const locked = actLocked(exAct);
  const editable = !locked && (!form || EDITABLE.includes(form.status));
  const canWithdraw = !locked && !!form && COUNTED.includes(form.status);

  const init = (): EditLine[] => (form?.lines.length ? form.lines.map((l) => ({ ...l, key: uid() })) : [{ key: uid(), markingTypeId: '', linearM: 0 }]);
  const [lines, setLines] = useState<EditLine[]>(init);
  const [scheme, setScheme] = useState<FileRef | null | undefined>(form?.schemeFile);
  const [photo, setPhoto] = useState<FileRef | null | undefined>(form?.photoFile);
  useEffect(() => {
    setLines(init());
    setScheme(form?.schemeFile);
    setPhoto(form?.photoFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form?.id, form?.status, form?.updatedAt]);

  const clean = lines.filter((l) => l.markingTypeId).map(({ markingTypeId, linearM }) => ({ markingTypeId, linearM }));
  const myM2 = linesM2(data, clean);
  const othersM2 = round2(data.forms
    .filter((f) => f.executionId === ex.id && f.contractorId !== me.contractorId && COUNTED.includes(f.status))
    .reduce((s, f) => s + formTotalM2(data, f), 0));
  const available = round2(ex.titleM2 - othersM2);
  const after = round2(available - myM2);
  const tol = data.settings.toleranceM2;
  const usedTypes = new Set(lines.map((l) => l.markingTypeId));

  const save = (andSubmit: boolean) => act((d, userId) => {
    const f = saveForm(d, userId, ex.id, { lines: clean, schemeFile: scheme ?? null, photoFile: photo ?? null });
    if (andSubmit) return submitForm(d, userId, f.id);
    return 'Черновик сохранён';
  }, (r) => r);

  const lastComment = form && [...form.history].reverse().find((h) => h.comment)?.comment;

  return (
    <Card size="small" title={<span>Моя форма {form && formStatusTag(me, form)}</span>} style={{ marginTop: 16 }}>
      {form?.status === 'REJECTED_BY_CLIENT' && <Alert type="error" showIcon style={{ marginBottom: 12 }} message="Форма отклонена заказчиком" description={lastComment} />}
      {form?.status === 'REJECTED_BY_GC' && <Alert type="error" showIcon style={{ marginBottom: 12 }} message="Форма возвращена генподрядчиком" description={lastComment} />}
      {form?.status === 'TITLE_CHANGED' && <Alert type="error" showIcon style={{ marginBottom: 12 }} message="Изменён титул — проверьте объёмы и подайте форму заново" description={lastComment} />}
      {form?.status === 'WAITING_PARTNER' && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Сумма объёмов ещё не равна титулу — ждём форму партнёра. Если недостача ваша — отзовите форму и дополните." />}
      {form?.autoZero && COUNTED.includes(form.status) && (
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Форма отправлена автоматически с нулями: весь объём выбран другим подрядчиком"
          description="Если вы выполняли работы на этом выполнении — отзовите форму и согласуйте распределение объёма с партнёром." />
      )}
      {locked && <Alert type="info" showIcon style={{ marginBottom: 12 }} message={`Акт ${exAct!.number}: ${ACT_STATUS[exAct!.status].label} — форма заблокирована.`} />}

      <Row gutter={12} style={{ marginBottom: 12 }}>
        {[
          ['Титул', ex.titleM2],
          ['Подано другими', othersM2],
          ['Доступно мне', available],
          ['Моя форма', myM2],
        ].map(([t, v]) => (
          <Col key={t as string} xs={12} md={6}>
            <div style={{ background: '#fafafa', borderRadius: 6, padding: '6px 10px' }}>
              <div style={{ fontSize: 12, color: '#888' }}>{t}</div>
              <b>{fmt(v as number)} м²</b>
            </div>
          </Col>
        ))}
      </Row>

      <Table
        size="small" pagination={false} bordered rowKey="key" dataSource={lines}
        columns={[
          {
            title: 'Вид разметки', render: (_, l) => (
              <Select
                style={{ width: '100%', minWidth: 220 }} disabled={!editable} placeholder="Выберите вид разметки" value={l.markingTypeId || undefined}
                onChange={(v) => setLines(lines.map((x) => (x.key === l.key ? { ...x, markingTypeId: v } : x)))}
                options={data.markingTypes.map((m) => ({ value: m.id, label: `${m.code} ${m.name}`, disabled: usedTypes.has(m.id) && m.id !== l.markingTypeId }))}
                showSearch optionFilterProp="label"
              />
            ),
          },
          { title: 'м²/п.м', width: 70, render: (_, l) => (l.markingTypeId ? fmt(coef(data.markingTypes.find((m) => m.id === l.markingTypeId))) : '—') },
          {
            title: 'Объём, п.м', width: 150, render: (_, l) => (
              <InputNumber min={0} step={10} precision={2} disabled={!editable} style={{ width: '100%' }} value={l.linearM}
                onChange={(v) => setLines(lines.map((x) => (x.key === l.key ? { ...x, linearM: Number(v) || 0 } : x)))} />
            ),
          },
          { title: '= м²', align: 'right', width: 100, render: (_, l) => <b>{l.markingTypeId ? fmt(lineM2(data, l)) : '—'}</b> },
          ...(editable ? [{
            title: '', width: 40, render: (_: any, l: EditLine) => (
              <Button size="small" type="text" danger icon={<DeleteOutlined />} disabled={lines.length === 1}
                onClick={() => setLines(lines.filter((x) => x.key !== l.key))} />
            ),
          }] : []),
        ]}
        summary={() => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={3} align="right"><b>Итого, м²</b></Table.Summary.Cell>
            <Table.Summary.Cell index={3} align="right"><b>{fmt(myM2)}</b></Table.Summary.Cell>
            {editable && <Table.Summary.Cell index={4} />}
          </Table.Summary.Row>
        )}
      />
      {editable && (
        <Button type="dashed" block icon={<PlusOutlined />} style={{ marginTop: 8 }} disabled={usedTypes.size >= data.markingTypes.length}
          onClick={() => setLines([...lines, { key: uid(), markingTypeId: '', linearM: 0 }])}>Добавить вид разметки</Button>
      )}
      {editable && (
        <div style={{ marginTop: 8 }}>
          {after < -tol - 1e-9
            ? <Alert type="error" showIcon message={`Превышение титула на ${fmt(-after)} м² — подать форму не получится`} />
            : Math.abs(after) <= tol + 1e-9
              ? <Alert type="success" showIcon message="С вашей формой объём сойдётся с титулом. Формы остальных подрядчиков (если не поданы) уйдут автоматически с нулями." />
              : <Alert type="warning" showIcon message={`После подачи останется недостача ${fmt(after)} м² — её должен закрыть партнёр`} />}
        </div>
      )}
      <Space direction="vertical" style={{ marginTop: 12 }}>
        <UploadPdf label="PDF-схема" value={scheme} onChange={setScheme} disabled={!editable} />
        <UploadPdf label="PDF-фото" value={photo} onChange={setPhoto} disabled={!editable} />
      </Space>
      <div style={{ marginTop: 12 }}>
        <Space wrap>
          {editable && <Button icon={<SaveOutlined />} onClick={() => save(false)}>Сохранить черновик</Button>}
          {editable && <Button type="primary" icon={<SendOutlined />} onClick={() => save(true)}>Подать форму</Button>}
          {canWithdraw && (
            <Popconfirm
              title="Отозвать форму?"
              description={form!.status === 'APPROVED_BY_CLIENT' ? 'Форма уже одобрена заказчиком — он и ГП получат уведомление.' : 'Форма вернётся в черновик, акт уйдёт на доработку.'}
              onConfirm={() => act((d, u) => withdrawForm(d, u, form!.id), 'Форма отозвана')}
            >
              <Button icon={<RollbackOutlined />}>Отозвать</Button>
            </Popconfirm>
          )}
        </Space>
      </div>
    </Card>
  );
}

// ---------------- Карточка формы (заказчик / ГП) ----------------

export function FormReview({ ex, contractorId }: { ex: Execution; contractorId: string }) {
  const data = useData();
  const me = useMe()!;
  const act = useAction();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [comment, setComment] = useState('');
  const guard = useGuardedClose();
  const form = data.forms.find((f) => f.executionId === ex.id && f.contractorId === contractorId);
  const isClient = me.role === 'CLIENT';
  const canDecide = isClient && form?.status === 'ON_CHECK_CLIENT';
  const hiddenForClient = isClient && (!form || form.status === 'DRAFT' || form.status === 'WAITING_PARTNER');
  const history = form ? form.history.filter((h) => !(isClient && /создана/i.test(h.action))) : [];
  return (
    <Card
      size="small"
      style={{ marginTop: 12, borderColor: canDecide ? '#91caff' : undefined }}
      title={<span>{cName(data, contractorId)} <Typography.Text type="secondary">({data.contractors.find((c) => c.id === contractorId)?.specialization})</Typography.Text></span>}
      extra={formStatusTag(me, hiddenForClient ? undefined : form)}
    >
      {!form || hiddenForClient ? <Typography.Text type="secondary">{isClient ? 'Форма ещё не передана на согласование' : 'Подрядчик ещё не начал заполнять форму'}</Typography.Text> : (
        <>
          {form.autoZero ? (
            <Alert type="info" showIcon message="Автоформа с нулевым объёмом: весь объём по выполнению выбран другими подрядчиками. Файлы не требуются." />
          ) : (
            <>
              <Table
                size="small" pagination={false} rowKey="markingTypeId" dataSource={form.lines}
                columns={[
                  { title: 'Вид разметки', render: (_, l) => { const m = data.markingTypes.find((x) => x.id === l.markingTypeId); return `${m?.code} ${m?.name}`; } },
                  { title: 'п.м', align: 'right', render: (_, l) => fmt(l.linearM) },
                  { title: 'м²', align: 'right', render: (_, l) => fmt(lineM2(data, l)) },
                ]}
                summary={() => (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={2} align="right"><b>Итого</b></Table.Summary.Cell>
                    <Table.Summary.Cell index={2} align="right"><b>{fmt(formTotalM2(data, form))}</b></Table.Summary.Cell>
                  </Table.Summary.Row>
                )}
              />
              <Space direction="vertical" style={{ marginTop: 8 }}>
                <FileLink file={form.schemeFile} label="Схема" />
                <FileLink file={form.photoFile} label="Фото" />
              </Space>
            </>
          )}
          {canDecide && (
            <div style={{ marginTop: 8 }}>
              <Space>
                <Button type="primary" icon={<CheckOutlined />} onClick={() => act((d, u) => clientApproveForm(d, u, form.id), 'Форма одобрена')}>Одобрить</Button>
                <Button danger icon={<CloseOutlined />} onClick={() => setRejectOpen(true)}>Отклонить</Button>
              </Space>
            </div>
          )}
          {isStaff(me.role) && form.status === 'ON_CHECK_CLIENT' && <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>Ожидает решения заказчика.</Typography.Paragraph>}
          <Collapse ghost items={[{ key: 'h', label: 'История формы', children: <History items={history} /> }]} />
        </>
      )}
      <Modal
        open={rejectOpen} title={`Отклонить форму: ${cName(data, contractorId)}`}
        okText="Отклонить" okButtonProps={{ danger: true, disabled: !comment.trim() }}
        onCancel={() => guard(!!comment.trim(), () => { setRejectOpen(false); setComment(''); })}
        onOk={() => {
          act((d, u) => clientRejectForm(d, u, form!.id, comment), 'Форма отклонена и возвращена подрядчику');
          setRejectOpen(false);
          setComment('');
        }}
      >
        <Typography.Paragraph type="secondary">Форма вернётся подрядчику. Одобренные формы других подрядчиков сохранят одобрение, если их объём не изменится.</Typography.Paragraph>
        <Input.TextArea rows={4} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Что нужно исправить" />
      </Modal>
    </Card>
  );
}

// ---------------- Создание / редактирование выполнения ----------------

export function ExecutionModal({ open, onClose, objectId, ex }: { open: boolean; onClose: () => void; objectId: string; ex?: Execution }) {
  const data = useData();
  const act = useAction();
  const guard = useGuardedClose();
  const [form] = Form.useForm();
  const title = Form.useWatch('titleM2', form);
  const obj = data.objects.find((o) => o.id === objectId)!;
  const available = round2(obj.titleM2 - allocatedM2(data, objectId, ex?.id));
  const nextNum = Math.max(0, ...data.executions.filter((e) => e.objectId === objectId).map((e) => e.number)) + 1;
  const inFlow = !!ex && data.forms.some((f) => f.executionId === ex.id && f.status !== 'DRAFT');
  const titleChanged = !!ex && title !== undefined && round2(Number(title)) !== ex.titleM2;
  return (
    <Modal
      open={open} width={640} destroyOnClose okText="Сохранить" onCancel={() => guard(form.isFieldsTouched(), onClose)}
      title={ex ? `Редактирование: ${ex.name}` : 'Новое выполнение'}
      onOk={() => form.validateFields().then((v) => {
        const ok = act((d, u) => {
          saveExecution(d, u, objectId, ex?.id || null, {
            number: v.number, name: v.name, periodFrom: v.period[0].format('YYYY-MM-DD'), periodTo: v.period[1].format('YYYY-MM-DD'),
            titleM2: Number(v.titleM2), contractorIds: v.contractorIds,
          }, v.reason || '');
          return true;
        }, 'Выполнение сохранено');
        if (ok) onClose();
      })}
    >
      <Form
        form={form} layout="vertical" preserve={false}
        initialValues={ex
          ? { ...ex, period: [dayjs(ex.periodFrom), dayjs(ex.periodTo)] }
          : { number: nextNum, name: `Выполнение №${nextNum}`, contractorIds: [], period: [dayjs().startOf('month'), dayjs().endOf('month')] }}
      >
        <Row gutter={12}>
          <Col span={6}><Form.Item name="number" label="№" rules={[{ required: true }]}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item></Col>
          <Col span={18}><Form.Item name="name" label="Название" rules={[{ required: true }]}><Input /></Form.Item></Col>
        </Row>
        <Form.Item name="period" label="Период работ" rules={[{ required: true }]}><DatePicker.RangePicker format="DD.MM.YYYY" style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="titleM2" label="Объём выполнения (общий, без разбивки по видам разметки)"
          rules={[{ required: true, message: 'Укажите объём' }, { validator: async (_, v) => { if (v > available + 1e-9) throw new Error(`Превышает доступный объём объекта (${fmt(available)} м²)`); } }]}
          extra={`Объём объекта ${fmt(obj.titleM2)} м², в других выполнениях ${fmt(obj.titleM2 - available)} м², доступно ${fmt(available)} м²`}>
          <InputNumber min={0.01} precision={2} addonAfter="м²" style={{ width: '100%' }} />
        </Form.Item>
        {titleChanged && inFlow && (
          <>
            <Alert type="warning" showIcon style={{ marginBottom: 12 }}
              message="По выполнению уже идёт согласование"
              description="Все поданные формы, включая одобренные заказчиком, вернутся подрядчикам на пересчёт, акт уйдёт на доработку. Изменение попадёт в журнал, участники получат уведомления." />
            <Form.Item name="reason" label="Причина изменения титула" rules={[{ required: true, message: 'Укажите причину' }]}>
              <Input.TextArea rows={2} />
            </Form.Item>
          </>
        )}
        <Form.Item name="contractorIds" label="Назначенные подрядчики" rules={[{ required: true, message: 'Назначьте хотя бы одного подрядчика' }]}
          extra={inFlow ? 'Состав подрядчиков нельзя менять, пока есть поданные формы' : undefined}>
          <Select mode="multiple" disabled={inFlow} options={data.contractors.map((c) => ({ value: c.id, label: `${c.name} (${c.specialization})` }))} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ---------------- Панель выполнения ----------------

function ExecutionPanel({ ex }: { ex: Execution }) {
  const data = useData();
  const me = useMe()!;
  const staff = isStaff(me.role);
  const run = useAction();
  const [edit, setEdit] = useState(false);
  const exAct = actOf(data, ex.id);
  const isClient = me.role === 'CLIENT';
  const obj = data.objects.find((o) => o.id === ex.objectId)!;
  const canManage = canManageObjects(me, obj);
  const finalized = !!exAct && ['APPROVED', 'ARCHIVED'].includes(exAct.status);
  const journal = executionJournal(data, me, ex);
  return (
    <div>
      <Descriptions size="small" column={1} labelStyle={{ width: 110 }} style={{ background: "#fafafa", padding: '12px 16px', borderRadius: 8 }}>
        <Descriptions.Item label="Период"><span style={{ whiteSpace: 'nowrap' }}>{fmtDay(ex.periodFrom)} — {fmtDay(ex.periodTo)}</span></Descriptions.Item>
        <Descriptions.Item label="Титул">
          <b>{fmt(ex.titleM2)} м²</b>
          {ex.titleChange && <Tag color="magenta" style={{ marginLeft: 8 }}>изменён: было {fmt(ex.titleChange.from)}</Tag>}
        </Descriptions.Item>
        <Descriptions.Item label="Подрядчики">{ex.contractorIds.map((c) => <Tag key={c}>{cName(data, c)}</Tag>)}</Descriptions.Item>
        <Descriptions.Item label="Статус" span={2}><ExecTag data={data} me={me} ex={ex} /></Descriptions.Item>
        {exAct && (
          <Descriptions.Item label="Акт" span={2}>
            <Link to={`/acts/${exAct.id}`}>{exAct.number}</Link> <Tag color={ACT_STATUS[exAct.status].color}>{ACT_STATUS[exAct.status].label}</Tag>
            {exAct.round > 1 && <Tag>редакция {exAct.round}</Tag>}
          </Descriptions.Item>
        )}
      </Descriptions>
      <TitleChangeBanner ex={ex} />

      <Space wrap style={{ marginTop: 12 }}>
        {canManage && !finalized && (
          <Button icon={<EditOutlined />} onClick={() => setEdit(true)}>Редактировать выполнение / объём</Button>
        )}
        {canManage && (
          <Popconfirm
            disabled={finalized}
            title={`Удалить ${ex.name}?`}
            description={<div style={{ maxWidth: 320 }}>Будут удалены формы подрядчиков{exAct ? `, акт ${exAct.number}` : ''} и загруженные к ним данные. Участники получат уведомление. Действие необратимо.</div>}
            okText="Удалить" okButtonProps={{ danger: true }}
            onConfirm={() => run((d, u) => deleteExecution(d, u, ex.id), 'Выполнение удалено')}
          >
            <Button danger icon={<DeleteOutlined />} disabled={finalized} title={finalized ? 'Есть согласованный/архивный акт — удаление запрещено' : undefined}>Удалить выполнение</Button>
          </Popconfirm>
        )}
        {exAct && <ActActions act={exAct} />}
      </Space>

      {(!isClient || exAct) && (
        <>
          <Typography.Title level={5} style={{ marginTop: 16 }}>Объёмы и сверка с титулом</Typography.Title>
          {me.role === 'CONTRACTOR' && <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>Объёмы других подрядчиков видны только цифрами, без файлов.</Typography.Paragraph>}
          <VolumesTable ex={ex} />
        </>
      )}

      {me.role === 'CONTRACTOR' && <ContractorFormEditor ex={ex} />}
      {(staff || (isClient && exAct)) && (
        <>
          <Typography.Title level={5} style={{ marginTop: 16 }}>
            Формы подрядчиков {isClient && exAct?.status === 'ON_CHECK_CLIENT' && <Tag color="blue">ждут вашего решения</Tag>}
          </Typography.Title>
          {ex.contractorIds.map((c) => <FormReview key={c} ex={ex} contractorId={c} />)}
        </>
      )}
      {isClient && !exAct && <Empty style={{ marginTop: 24 }} description="Подрядчики ещё не передали формы на согласование" />}

      <Collapse style={{ marginTop: 16 }} items={[{
        key: 'j',
        label: <span>Журнал выполнения <Badge count={journal.length} color="#bfbfbf" style={{ marginLeft: 6 }} />
          {journal.some((j) => j.highlight) && <Tag color="magenta" style={{ marginLeft: 8 }}>есть важные изменения</Tag>}</span>,
        children: <History items={journal} />,
      }]} />
      {canManage && <ExecutionModal open={edit} onClose={() => setEdit(false)} objectId={ex.objectId} ex={ex} />}
    </div>
  );
}

// ---------------- Карточка объекта ----------------

export default function ObjectCard() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const data = useData();
  const me = useMe()!;
  const run = useAction();
  const staff = isStaff(me.role);
  const [editObj, setEditObj] = useState(false);
  const [newEx, setNewEx] = useState(false);
  const obj = visibleObjects(data, me).find((o) => o.id === id);
  if (!obj) return <Card><Empty description="Объект не найден или нет доступа" /><Button onClick={() => nav('/objects')}>К списку</Button></Card>;
  const exs = visibleExecutions(data, me, obj.id);
  const activeEx = sp.get('ex') && exs.some((e) => e.id === sp.get('ex')) ? sp.get('ex')! : exs[0]?.id;
  const approvedActs = data.acts.filter((a) => a.objectId === obj.id && a.status === 'APPROVED');
  const canManage = canManageObjects(me, obj);
  const alloc = allocatedM2(data, obj.id);
  const locked = data.acts.some((a) => a.objectId === obj.id && ['APPROVED', 'ARCHIVED'].includes(a.status));
  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Card
        title={<Space><Button type="text" icon={<ArrowLeftOutlined />} onClick={() => nav('/objects')} />№ {obj.excelRowNumber}. {obj.name}</Space>}
        extra={(staff || canManage) && (
          <Space wrap>
            {staff && <Popconfirm
              disabled={!approvedActs.length}
              title={`Отправить в архив согласованные акты (${approvedActs.length})?`}
              description={approvedActs.map((a) => a.number).join(', ')}
              onConfirm={() => run((d, u) => approvedActs.forEach((a) => archiveAct(d, u, a.id)), 'Акты отправлены в архив')}
            >
              <Button icon={<InboxOutlined />} disabled={!approvedActs.length}>В архив{approvedActs.length ? ` (${approvedActs.length})` : ''}</Button>
            </Popconfirm>}
            {canManage && <Button icon={<EditOutlined />} onClick={() => setEditObj(true)}>Изменить</Button>}
            {canManage && (
              <Popconfirm
                disabled={locked}
                title={`Удалить объект №${obj.excelRowNumber}?`}
                description={<div style={{ maxWidth: 320 }}>Будут удалены все выполнения ({exs.length}), формы, акты и чат объекта. Действие необратимо.</div>}
                okText="Удалить" okButtonProps={{ danger: true }}
                onConfirm={() => { if (run((d, u) => { deleteObject(d, u, obj.id); return true; }, 'Объект удалён')) nav('/objects'); }}
              >
                <Button danger icon={<DeleteOutlined />} disabled={locked} title={locked ? 'На объекте есть согласованные/архивные акты — удаление запрещено' : undefined}>Удалить</Button>
              </Popconfirm>
            )}
            {canManage && <Button type="primary" icon={<PlusOutlined />} disabled={alloc >= obj.titleM2} onClick={() => setNewEx(true)}>Выполнение</Button>}
          </Space>
        )}
      >
        <Descriptions size="small" column={{ xs: 1, md: 3 }}>
          <Descriptions.Item label="Адрес">{obj.address}</Descriptions.Item>
          <Descriptions.Item label="Округ">{obj.district}</Descriptions.Item>
          <Descriptions.Item label="Заказчик">{data.clients.find((c) => c.id === obj.clientId)?.name}</Descriptions.Item>
          <Descriptions.Item label="Общий объём"><b>{fmt(obj.titleM2)} м²</b></Descriptions.Item>
          <Descriptions.Item label="В выполнениях">{fmt(alloc)} м²</Descriptions.Item>
          <Descriptions.Item label="Не распределено">{alloc >= obj.titleM2 ? <Tag color="green">0 м² — весь объём распределён</Tag> : `${fmt(obj.titleM2 - alloc)} м²`}</Descriptions.Item>
        </Descriptions>
      </Card>
      <Row gutter={16}>
        <Col xs={24} xl={16}>
          <Card>
            {exs.length === 0 ? <Empty description="Выполнений нет" /> : (
              <Tabs
                activeKey={activeEx}
                onChange={(k) => setSp({ ex: k })}
                items={exs.map((e) => ({
                  key: e.id,
                  label: <span>{e.name}{e.titleChange && <WarningOutlined style={{ color: '#eb2f96', marginLeft: 6 }} />}</span>,
                  children: <ExecutionPanel key={e.id} ex={e} />,
                }))}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card title="Чат по объекту"><Chat objectId={obj.id} /></Card>
        </Col>
      </Row>
      {canManage && <ObjectModal open={editObj} onClose={() => setEditObj(false)} obj={obj} />}
      {canManage && <ExecutionModal open={newEx} onClose={() => setNewEx(false)} objectId={obj.id} />}
    </Space>
  );
}
