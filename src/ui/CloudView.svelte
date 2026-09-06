<script lang="ts">
  import type { SharePermission } from '../lib/api.ts';
  import type { CloudConnection, ShareLinkInfo } from './cache.ts';
  import { localizedText, type LocalizedText } from './errors.ts';
  import { t } from './i18n.svelte.ts';
  import Icon from './Icon.svelte';

  let {
    connected, saving, creating, pending, error, savedAt, autosave, shares, revisionAhead,
    onautosave, onsave, oncreate, onrevoke, oncopy,
  }: {
    connected: CloudConnection | null;
    saving: boolean;
    creating: boolean;
    pending: boolean;
    error: LocalizedText | null;
    savedAt: string;
    autosave: boolean;
    shares: ShareLinkInfo[];
    revisionAhead: boolean;
    onautosave: (on: boolean) => void;
    onsave: (name: string) => void;
    oncreate: (share: { permission: SharePermission; pinned: boolean; expiresAt?: string }) => void;
    onrevoke: (shareId: string) => void;
    oncopy: (text: string, label: { en: string; th: string }) => void;
  } = $props();

  let name = $state('');
  const permissions: { value: SharePermission; label: [string, string]; note: [string, string]; warn?: boolean }[] = [
    { value: 'schedule', label: ['Schedule', 'ตารางสอบ'], note: ['Sees the published schedule and rooms only. No roster detail, no source files.', 'เห็นเฉพาะตารางสอบและห้องสอบ ไม่มีรายชื่อผู้คุมหรือไฟล์ต้นทาง'] },
    { value: 'audit', label: ['Audit', 'ตรวจสอบ'], note: ['Adds normalized inputs, rules, assignments, validation and provenance for verification.', 'เพิ่มข้อมูลที่จัดรูปแบบแล้ว เงื่อนไข การจัด ผลการตรวจ และที่มา เพื่อการตรวจสอบ'] },
    { value: 'full_project', label: ['Full project', 'โครงการเต็ม'], note: ['Includes the complete project and raw source files. Use for transferring or archiving.', 'รวมโครงการทั้งหมดและไฟล์ต้นทาง ใช้ย้ายหรือเก็บถาวร'] },
    { value: 'edit', label: ['Edit', 'แก้ไข'], note: ['Full project plus the right to save new revisions. Share deliberately.', 'โครงการเต็มรวมสิทธิ์บันทึกฉบับแก้ไข ใช้เท่าที่จำเป็น'], warn: true },
  ];
  const expiryOptions = [
    { key: 'never', label: ['Never expires', 'ไม่มีวันหมดอายุ'] },
    { key: '1', label: ['Expires in 1 day', 'หมดอายุใน 1 วัน'] },
    { key: '7', label: ['Expires in 7 days', 'หมดอายุใน 7 วัน'] },
    { key: '30', label: ['Expires in 30 days', 'หมดอายุใน 30 วัน'] },
  ];
  let permission = $state<SharePermission>('schedule');
  let pinned = $state('false');
  let expiry = $state('never');
  let chosen = $derived(permissions.find(p => p.value === permission)!);
  const expiryDate = (key: string) => key === 'never' ? undefined : new Date(Date.now() + Number(key) * 86400000).toISOString();
  const permissionChip = (value: string) => t({ schedule: 'Schedule', audit: 'Audit', full_project: 'Full project', edit: 'Edit' }[value] ?? value, { schedule: 'ตารางสอบ', audit: 'ตรวจสอบ', full_project: 'โครงการเต็ม', edit: 'แก้ไข' }[value] ?? value);
</script>

<div class="cloud-layout">
  <div class="source-main">
    <section class="panel">
      <h2>{t('Cloud project', 'โครงการบนคลาวด์')}</h2>
      {#if connected}
        <dl class="audit-grid">
          <div><dt>{t('Project', 'โครงการ')}</dt><dd>{connected.name} · <code>{connected.projectId}</code></dd></div>
          <div><dt>{t('Current revision', 'ฉบับปัจจุบัน')}</dt><dd><code>{connected.revisionId}</code>{#if connected.savedAt}<small class="muted"> · {connected.savedAt}</small>{/if}</dd></div>
        </dl>
        <p class="muted">{t('Every save creates a new immutable revision. Another device saving first is detected, never silently overwritten.', 'ทุกครั้งที่บันทึกจะสร้างฉบับใหม่ที่แก้ไขไม่ได้ หากอุปกรณ์อื่นบันทึกก่อน ระบบจะแจ้งเสมอ ไม่เขียนทับเงียบ ๆ')}</p>
        {#if revisionAhead}<div class="notice warning"><Icon name="info" /><p>{t('This schedule changed after the last cloud revision. Save to publish the current state.', 'ตารางนี้เปลี่ยนหลังฉบับล่าสุดบนคลาวด์ บันทึกเพื่อเผยแพร่สถานะปัจจุบัน')}</p></div>{/if}
        <div class="inline-actions">
          <button class="button primary compact" disabled={saving} onclick={() => onsave('')}>{saving ? t('Saving…', 'กำลังบันทึก…') : t('Save now', 'บันทึกเดี๋ยวนี้')}</button>
          <button class="button secondary compact" onclick={() => oncopy(location.origin + location.pathname + '#/share/' + connected!.ownerShareId + '/' + connected!.ownerSecret, { en: 'Project link', th: 'ลิงก์โครงการ' })}><Icon name="link" size={15} />{t('Copy project link', 'คัดลอกลิงก์โครงการ')}</button>
        </div>
        <label class="check-row"><input type="checkbox" checked={autosave} onchange={e => onautosave(e.currentTarget.checked)} /><span>{t('Autosave after changes', 'บันทึกอัตโนมัติเมื่อมีการแก้ไข')}<small class="muted">{t('Saves once you stop editing for 10 seconds. Each change still becomes its own revision.', 'บันทึกเมื่อหยุดแก้ไข 10 วินาที การแก้ไขแต่ละครั้งเป็นฉบับใหม่ของตัวเอง')}{#if pending} · {t('save pending', 'รอบันทึก')}{/if}</small></span></label>
      {:else}
        <p class="muted">{t('Scheduling stays in this browser. Saving copies the project — timings, assignments and raw source files — to your cloud server as an immutable revision.', 'การจัดตารางทำในเบราว์เซอร์เสมอ การบันทึกคัดลอกโครงการ เวลา การจัดห้องผู้คุม และไฟล์ต้นทาง ไปเก็บบนเซิร์ฟเวอร์เป็นฉบับที่แก้ไขไม่ได้')}</p>
        <label class="stacked-label">{t('Project name', 'ชื่อโครงการ')}
          <input type="text" bind:value={name} placeholder={t('Exam schedule', 'ตารางสอบ')} maxlength={80} />
        </label>
        <div class="inline-actions"><button class="button primary compact" disabled={saving} onclick={() => onsave(name)}>{saving ? t('Saving…', 'กำลังบันทึก…') : t('Save to cloud', 'บันทึกขึ้นคลาวด์')}</button></div>
        <p class="muted">{t('This browser receives a private project link that can reopen and continue saving this project. Keep it like a password.', 'เบราว์เซอร์นี้จะได้ลิงก์โครงการส่วนตัวสำหรับเปิดและบันทึกต่อ โปรดเก็บเหมือนรหัสผ่าน')}</p>
      {/if}
      {#if error}<div class="notice danger"><Icon name="alert" /><p>{localizedText(error)}</p></div>{/if}
    </section>

    <section class="panel">
      <div class="section-heading"><h2>{t('Share links', 'ลิงก์แชร์')}</h2>{#if connected}<span class="count-label">{shares.filter(s => !s.revokedAt).length} {t('active', 'ใช้งานได้')}</span>{/if}</div>
      {#if connected}
        <div class="share-create">
          <label>{t('Permission', 'สิทธิ์')}
            <select bind:value={permission}>
              {#each permissions as p}<option value={p.value}>{t(p.label[0], p.label[1])}</option>{/each}
            </select>
          </label>
          <label>{t('Revision', 'ฉบับ')}
            <select bind:value={pinned}>
              <option value={'false'}>{t('Live — follows the current revision', 'ตามฉบับล่าสุด')}</option>
              <option value={'true'}>{t('Pinned — frozen at the saved revision', 'ตรึงฉบับที่บันทึกไว้')}</option>
            </select>
          </label>
          <label>{t('Expiry', 'อายุ')}
            <select bind:value={expiry}>{#each expiryOptions as option}<option value={option.key}>{t(option.label[0], option.label[1])}</option>{/each}</select>
          </label>
          <button class="button secondary compact" disabled={saving || creating} onclick={() => oncreate({ permission, pinned: pinned === 'true', expiresAt: expiryDate(expiry) })}>{creating ? t('Creating…', 'กำลังสร้าง…') : t('Create share link', 'สร้างลิงก์แชร์')}</button>
        </div>
        <p class="field-hint">{t(chosen.note[0], chosen.note[1])}{#if chosen.warn} {t('Anyone with this link can change the saved schedule.', 'ผู้ที่มีลิงก์นี้สามารถเปลี่ยนตารางที่บันทึกได้')}{/if}{#if pinned === 'true'} · {t(`Pinned to ${connected.revisionId}.`, `ตรึงไว้ที่ฉบับ ${connected.revisionId}`)}{/if}</p>
        {#if shares.length}
          <div class="share-list">
            {#each shares as share (share.shareId)}
              <div class="share-row" class:revoked={!!share.revokedAt} class:owner={share.shareId === connected.ownerShareId}>
                <div class="share-copy">
                  <strong>{permissionChip(share.permission)}{#if share.shareId === connected.ownerShareId} · {t('this browser', 'เบราว์เซอร์นี้')}{/if}</strong>
                  <small class="muted"><code>{share.shareId}</code> · {share.revisionId ? t(`pinned to ${share.revisionId}`, `ตรึงฉบับ ${share.revisionId}`) : t('live', 'ตามฉบับล่าสุด')}{#if share.expiresAt} · {t(`expires ${share.expiresAt.slice(0, 10)}`, `หมดอายุ ${share.expiresAt.slice(0, 10)}`)}{/if}{#if share.revokedAt} · {t('revoked', 'เพิกถอนแล้ว')}{/if}</small>
                </div>
                <div class="inline-actions">
                  {#if !share.revokedAt}<button class="button secondary compact" onclick={() => oncopy(location.origin + location.pathname + '#/share/' + share.shareId + '/' + share.secret, { en: `${permissions.find(p => p.value === share.permission)?.label[0] ?? share.permission}`, th: `${permissions.find(p => p.value === share.permission)?.label[1] ?? share.permission}` })}>{t('Copy link', 'คัดลอกลิงก์')}</button>
                  {:else}<span class="status warning-status">{t('Revoked', 'เพิกถอนแล้ว')}</span>{/if}
                  {#if !share.revokedAt && share.shareId !== connected.ownerShareId}<button class="button secondary compact" onclick={() => onrevoke(share.shareId)}>{t('Revoke', 'เพิกถอน')}</button>{/if}
                </div>
              </div>
            {/each}
          </div>
        {:else}<p class="empty-help">{t('No share links yet. Create one to let others open this schedule with exactly the scope you choose.', 'ยังไม่มีลิงก์แชร์ สร้างเพื่อให้ผู้อื่นเปิดตารางได้ตามขอบเขตที่คุณเลือก')}</p>{/if}
      {:else}<p class="empty-help">{t('Save the project to the cloud first; sharing hands out copies or scoped views of a saved revision.', 'บันทึกขึ้นคลาวด์ก่อน การแชร์มอบสำเนาหรือมุมมองบางส่วนของฉบับที่บันทึกไว้')}</p>{/if}
    </section>
  </div>

</div>
