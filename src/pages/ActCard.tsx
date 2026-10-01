import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Card, Col, Descriptions, Empty, Input, InputNumber, Modal, Row, Space, Steps, Table, Tag, Typography } from 'antd';
import { ArrowLeftOutlined, DownloadOutlined, EditOutlined, WarningOutlined } from '@ant-design/icons';
import JSZip from 'jszip';
import { useData, useMe } from '../store';
import { ACT_STATUS, type Act, type Data, type FileRef } from '../types';
import { canDownloadFile, coef, fmt, fmtCoef, isStaff, lineM2, linesM2, round2, visibleActs } from '../logic';
import { actions } from '../actions';
import { downloadBlob, fetchFileBlob } from '../files';
import { FileLink, History, PageTitle, fmtDate, fmtDay, useAction, useGuardedClose } from '../components/common';
import Chat from '../components/Chat';
import ActActions from '../components/ActActions';
import { FormReview } from './ObjectCard';

const cName = (d: Data, id: string) => d.contractors.find((c) => c.id === id)?.name || '—';

/** Сводная таблица: строки — виды разметки, использованные в акте, колонки — подрядчики. */
export function actSummary(data: Data, act: Act) {
  const ex = data.executions.find((e) => e.id === act.executionId)!;
  const typeIds = [...new Set(act.rows.flatMap((r) => r.lines.map((l) => l.markingTypeId)))]
    .sort((a, b) => (data.markingTypes.find((m) => m.id === a)?.code || '').localeCompare(data.markingTypes.find((m) => m.id === b)?.code || '', 'ru', { numeric: true }));
  const rows = typeIds.map((tid) => {
    const mt = data.markingTypes.find((m) => m.id === tid);
    const per = act.rows.map((r) => {
      const l = r.lines.find((x) => x.markingTypeId === tid);
      return { pm: l?.linearM || 0, m2: l ? lineM2(data, l) : 0 };
    });
    return { key: tid, mt, per, total: round2(per.reduce((s, x) => s + x.m2, 0)) };
  });
  return { ex, rows };
}

export async function downloadActZip(data: Data, act: Act, filter: (f: FileRef) => boolean) {
  const zip = new JSZip();
  const obj = data.objects.find((o) => o.id === act.objectId)!;
  for (const r of act.rows) {
    const folder = zip.folder(cName(data, r.contractorId).replace(/[\\/:*?"<>|«»]/g, ''))!;
    for (const [kind, f] of [['Схема', r.schemeFile], ['Фото', r.photoFile]] as const) {
      if (f && filter(f)) folder.file(`${kind}_${f.name}`, await fetchFileBlob(f));
    }
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  await downloadBlob(blob, `${act.number}_№${obj.excelRowNumber}.zip`);
}

function CorrectionModal({ act, open, onClose }: { act: Act; open: boolean; onClose: () => void }) {
  const data = useData();
  const run = useAction();
  const { rows } = actSummary(data, act);
  const [vals, setVals] = useState(() => act.rows.map((r) => ({
    contractorId: r.contractorId,
    lines: rows.map((x) => ({ markingTypeId: x.key, linearM: r.lines.find((l) => l.markingTypeId === x.key)?.linearM || 0 })),
  })));
  const [reason, setReason] = useState('');
  const guard = useGuardedClose();
  const [dirty, setDirty] = useState(false);
  const ex = data.executions.find((e) => e.id === act.executionId)!;
  const newTotal = round2(vals.reduce((s, v) => s + linesM2(data, v.lines), 0));
  return (
    <Modal open={open} width={760} title={`Корректировка акта ${act.number} (только ГП)`} okText="Сохранить корректировку" onCancel={() => guard(dirty || !!reason.trim(), onClose)}
      okButtonProps={{ disabled: !reason.trim() }}
      onOk={async () => {
        const ok = await run(() => actions.correctAct(act.id, vals, reason), 'Корректировка сохранена и записана в журнал');
        if (ok) onClose();
      }}>
      <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Акт уже согласован. Каждое изменение записывается в историю с причиной." />
      <Table size="small" pagination={false} rowKey="key" dataSource={rows} bordered
        columns={[
          { title: 'Вид разметки', render: (_, r) => r.mt?.code },
          ...vals.map((v, i) => ({
            title: `${cName(data, v.contractorId)}, пог. м`,
            render: (_: any, r: any) => (
              <InputNumber decimalSeparator="," min={0} precision={2} value={v.lines.find((l) => l.markingTypeId === r.key)?.linearM}
                onChange={(x) => { setDirty(true); setVals(vals.map((vv, j) => (j !== i ? vv : { ...vv, lines: vv.lines.map((l) => (l.markingTypeId === r.key ? { ...l, linearM: Number(x) || 0 } : l)) }))); }} />
            ),
          })),
        ]} />
      <div style={{ marginTop: 8 }}>
        Итого после корректировки: <b>{fmt(newTotal)} м²</b> при титуле {fmt(ex.titleM2)} м²
        {Math.abs(newTotal - ex.titleM2) > 1e-9 && <Tag color="orange" style={{ marginLeft: 8 }}>не совпадает с титулом</Tag>}
      </div>
      <Input.TextArea style={{ marginTop: 12 }} rows={3} placeholder="Причина корректировки (обязательно)" value={reason} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  );
}

const FLOW = ['ON_CHECK_CLIENT', 'ON_CHECK_GC', 'APPROVED', 'ARCHIVED'];

export default function ActCard() {
  const zipAction = useAction();
  const { id } = useParams();
  const nav = useNavigate();
  const data = useData();
  const me = useMe()!;
  const [correct, setCorrect] = useState(false);
  const act = visibleActs(data, me).find((a) => a.id === id);
  if (!act) return <Card><Empty description="Акт не найден или нет доступа" /><Button onClick={() => nav(-1)}>Назад</Button></Card>;
  const staff = isStaff(me.role);
  const obj = data.objects.find((o) => o.id === act.objectId)!;
  const { ex, rows } = actSummary(data, act);
  const factTotal = round2(rows.reduce((s, r) => s + r.total, 0));
  const step = act.status === 'IN_REVISION' ? 0 : FLOW.indexOf(act.status);

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Card
        title={<PageTitle onBack={() => nav(-1)} tags={<><Tag color={ACT_STATUS[act.status].color}>{ACT_STATUS[act.status].label}</Tag>{act.round > 1 && <Tag>редакция {act.round}</Tag>}</>}>{`Акт освидетельствования скрытых работ ${act.number}`}</PageTitle>}
        extra={
          <Space wrap>
            <ActActions act={act} />
            {me.role === 'GC' && ['APPROVED', 'ARCHIVED'].includes(act.status) && <Button icon={<EditOutlined />} onClick={() => setCorrect(true)}>Корректировка</Button>}
            <Button icon={<DownloadOutlined />} onClick={() => zipAction(() => downloadActZip(data, act, (f) => canDownloadFile(data, me, f.id)))}>
              {me.role === 'CONTRACTOR' ? 'Мои приложения (ZIP)' : 'Все приложения (ZIP)'}
            </Button>
          </Space>
        }
      >
        <Steps size="small" current={step} status={act.status === 'IN_REVISION' ? 'error' : undefined} style={{ marginBottom: 16 }}
          items={[
            { title: act.status === 'IN_REVISION' ? 'На доработке' : 'Заказчик', description: 'проверка форм' },
            { title: 'Генподрядчик', description: 'проверка акта' },
            { title: 'Согласован', description: 'выгрузка в Word' },
            { title: 'Архив' },
          ]} />
        {ex.titleChange && (
          <Alert type="error" showIcon icon={<WarningOutlined />} style={{ marginBottom: 12, background: '#fff0f6', borderColor: '#ff85c0' }}
            message={<b>Изменён титул: {fmt(ex.titleChange.from)} → {fmt(ex.titleChange.to)} м² ({fmtDate(ex.titleChange.at)})</b>}
            description={<>{ex.titleChange.reason && <div>Причина: {ex.titleChange.reason}</div>}Одобрения сняты, формы у подрядчиков на пересчёте.</>} />
        )}
        <Descriptions size="small" column={{ xs: 1, md: 3 }} bordered>
          <Descriptions.Item label="Объект"><Link to={`/objects/${obj.id}?ex=${ex.id}`}>№ {obj.excelRowNumber}. {obj.name}</Link></Descriptions.Item>
          <Descriptions.Item label="Адрес">{obj.address}</Descriptions.Item>
          <Descriptions.Item label="Округ">{obj.district}</Descriptions.Item>
          <Descriptions.Item label="Выполнение">{ex.name}</Descriptions.Item>
          <Descriptions.Item label="Период">{`${fmtDay(ex.periodFrom)} — ${fmtDay(ex.periodTo)}`}</Descriptions.Item>
          <Descriptions.Item label="Заказчик">{data.clients.find((c) => c.id === obj.clientId)?.name}</Descriptions.Item>
          <Descriptions.Item label="Титульный объём"><b>{fmt(ex.titleM2)} м²</b></Descriptions.Item>
          <Descriptions.Item label="Создан">{fmtDate(act.createdAt)}</Descriptions.Item>
          <Descriptions.Item label="Word">{act.wordDownloadedAt ? `выгружен ${fmtDate(act.wordDownloadedAt)}` : '—'}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Row gutter={16}>
        <Col xs={24} xl={16}>
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            <Card title="Сводная таблица объёмов">
              <Table
                size="small" bordered pagination={false} dataSource={rows} scroll={{ x: true }}
                locale={{ emptyText: 'Объёмов нет' }}
                columns={[
                  { title: 'Вид разметки', render: (_, r) => <span><b>{r.mt?.code}</b> {r.mt?.name}</span> },
                  { title: 'м² на 1 пог. м', render: (_, r) => fmtCoef(coef(r.mt)), width: 96 },
                  ...act.rows.map((row, i) => ({
                    title: <span>{cName(data, row.contractorId)}{row.autoZero && <div><Tag color="cyan" style={{ fontSize: 10 }}>авто, 0 м²</Tag></div>}</span>,
                    align: 'right' as const,
                    render: (_: any, r: any) => (r.per[i].m2 ? <span>{fmt(r.per[i].m2)} м²<br /><Typography.Text type="secondary" style={{ fontSize: 11 }}>{fmt(r.per[i].pm)} пог. м</Typography.Text></span> : '—'),
                  })),
                  { title: 'Итого, м²', align: 'right', render: (_, r) => <b>{fmt(r.total)}</b> },
                ]}
                summary={() => (
                  <>
                    <Table.Summary.Row style={{ background: '#f3f5f8' }}>
                      <Table.Summary.Cell index={0} colSpan={2}><b>Итого по подрядчикам</b></Table.Summary.Cell>
                      {act.rows.map((r, i) => <Table.Summary.Cell key={i} index={2 + i} align="right">{fmt(linesM2(data, r.lines))}</Table.Summary.Cell>)}
                      <Table.Summary.Cell index={99} align="right"><b>{fmt(factTotal)}</b></Table.Summary.Cell>
                    </Table.Summary.Row>
                    <Table.Summary.Row style={{ background: '#f3f5f8' }}>
                      <Table.Summary.Cell index={0} colSpan={2 + act.rows.length}><b>Титульный объём</b></Table.Summary.Cell>
                      <Table.Summary.Cell index={99} align="right">
                        <b>{fmt(ex.titleM2)}</b>{Math.abs(factTotal - ex.titleM2) > 1e-9 && <div><Tag color="orange">расхождение {fmt(factTotal - ex.titleM2)}</Tag></div>}
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  </>
                )}
              />
            </Card>

            {(me.role === 'CLIENT' || staff) && ['ON_CHECK_CLIENT', 'IN_REVISION'].includes(act.status) ? (
              <Card title={me.role === 'CLIENT' ? 'Формы подрядчиков — решение по каждой' : 'Формы подрядчиков'} styles={{ body: { paddingTop: 0 } }}>
                {ex.contractorIds.map((c) => <FormReview key={c} ex={ex} contractorId={c} />)}
              </Card>
            ) : (
              <Card title="Приложения к акту">
                {act.rows.map((r) => (
                  <div key={r.contractorId} style={{ marginBottom: 12 }}>
                    <b>{cName(data, r.contractorId)}</b>
                    <div style={{ paddingLeft: 12 }}>
                      {r.autoZero ? <Typography.Text type="secondary">автоматическая форма с нулевым объёмом — файлы не требуются</Typography.Text> : (
                        <>
                          <div><FileLink file={r.schemeFile} label="Схема" /></div>
                          <div><FileLink file={r.photoFile} label="Фото" /></div>
                        </>
                      )}
                    </div>
                  </div>
                ))}
                {me.role === 'CONTRACTOR' && <Typography.Text type="secondary">Файлы других подрядчиков недоступны.</Typography.Text>}
              </Card>
            )}
            <Card title="История акта"><History items={act.history} /></Card>
          </Space>
        </Col>
        <Col xs={24} xl={8}>
          <Card title="Чат по объекту"><Chat objectId={obj.id} /></Card>
        </Col>
      </Row>
      {correct && <CorrectionModal act={act} open={correct} onClose={() => setCorrect(false)} />}
    </Space>
  );
}
