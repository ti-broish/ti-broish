import { getRequestHost } from '@tanstack/react-start/server'
import { env } from 'cloudflare:workers'

const FROM = { email: 'noreply@tibroish.bg', name: 'Ти Броиш' }

export interface OutboundMail {
  to: string
  subject: string
  text: string
  html: string
}

export function confirmCodeMail(email: string, code: string): OutboundMail {
  const text = [
    'Здравей,',
    `Кодът за потвърждение е ${code}.`,
    'Въведи го в записването, за да продължиш.',
    'Записването е за президентските избори 2026 г. на 25 октомври и 1 ноември.',
    'Това е доброволна дейност без заплащане. Ще бъдете представител на Инициативния комитет за кандидат-президентската двойка Андрей Гюров и Георги Кандев.',
  ].join('\n\n')
  return {
    to: email,
    subject: 'Код за потвърждение — Ти Броиш',
    text,
    html: `<p>Здравей,</p><p>Кодът за потвърждение е <strong>${escapeHtml(code)}</strong>.</p><p>Въведи го в записването, за да продължиш.</p><p>Записването е за президентските избори 2026 г. на 25 октомври и 1 ноември.</p><p>Това е доброволна дейност без заплащане. Ще бъдете представител на Инициативния комитет за кандидат-президентската двойка Андрей Гюров и Георги Кандев.</p>`,
  }
}

export function staffInviteMail(email: string, roleLabel: string, link: string): OutboundMail {
  const text = [
    'Здравей,',
    `Поканиха те в екипа на Ти Броиш като ${roleLabel}.`,
    'Влез с този имейл в профила си и отвори страницата на екипа.',
    link,
  ].join('\n\n')
  const href = escapeHtml(link)
  return {
    to: email,
    subject: 'Покана за екипа — Ти Броиш',
    text,
    html: `<p>Здравей,</p><p>Поканиха те в екипа на Ти Броиш като <strong>${escapeHtml(roleLabel)}</strong>.</p><p>Влез с този имейл в профила си и отвори <a href="${href}">страницата на екипа</a>.</p>`,
  }
}

export function importConfirmMail(email: string, link: string): OutboundMail {
  const text = [
    'Здравей,',
    'Екипът те записа като пазител на вота.',
    `Отвори линка, за да потвърдиш имейла или да промениш данните: ${link}`,
    'Записването е за президентските избори 2026 г. на 25 октомври и 1 ноември.',
    'Това е доброволна дейност без заплащане. Ще бъдете представител на Инициативния комитет за кандидат-президентската двойка Андрей Гюров и Георги Кандев.',
  ].join('\n\n')
  const href = escapeHtml(link)
  return {
    to: email,
    subject: 'Потвърди данните си — Ти Броиш',
    text,
    html: `<p>Здравей,</p><p>Екипът те записа като пазител на вота.</p><p><a href="${href}">Потвърди имейла или промени данните</a></p><p>Ако линкът не се отваря, копирай този адрес:<br>${href}</p><p>Записването е за президентските избори 2026 г. на 25 октомври и 1 ноември.</p><p>Това е доброволна дейност без заплащане. Ще бъдете представител на Инициативния комитет за кандидат-президентската двойка Андрей Гюров и Георги Кандев.</p>`,
  }
}

export function companionConfirmMail(email: string, link: string): OutboundMail {
  const text = [
    'Здравей,',
    'Поканиха те в група в Ти Броиш.',
    `Отвори линка, за да потвърдиш, че си в групата: ${link}`,
    'Записването е за президентските избори 2026 г. на 25 октомври и 1 ноември.',
    'Това е доброволна дейност без заплащане. Ще бъдете представител на Инициативния комитет за кандидат-президентската двойка Андрей Гюров и Георги Кандев.',
  ].join('\n\n')
  const href = escapeHtml(link)
  return {
    to: email,
    subject: 'Потвърди, че си в групата — Ти Броиш',
    text,
    html: `<p>Здравей,</p><p>Поканиха те в група в Ти Броиш.</p><p><a href="${href}">Потвърди, че си в групата</a></p><p>Ако линкът не се отваря, копирай този адрес:<br>${href}</p><p>Записването е за президентските избори 2026 г. на 25 октомври и 1 ноември.</p><p>Това е доброволна дейност без заплащане. Ще бъдете представител на Инициативния комитет за кандидат-президентската двойка Андрей Гюров и Георги Кандев.</p>`,
  }
}

export function assignmentMail(email: string, section: string, address: string, link: string): OutboundMail {
  const place = address.trim() || 'адресът е в профила ти'
  const text = [
    'Здравей,',
    `Разпределихме те в секция ${section}.`,
    `Място: ${place}.`,
    `Виж секцията и инструкциите в профила: ${link}`,
    'Ако нещо не е наред, остави бележка в профила. Екипът ще я види.',
  ].join('\n\n')
  const href = escapeHtml(link)
  const sectionHtml = escapeHtml(section)
  const placeHtml = escapeHtml(place)
  return {
    to: email,
    subject: `Секция ${section} — Ти Броиш`,
    text,
    html: `<p>Здравей,</p><p>Разпределихме те в секция <strong>${sectionHtml}</strong>.</p><p>Място: ${placeHtml}.</p><p><a href="${href}">Отвори профила</a>, за да видиш секцията и инструкциите.</p><p>Ако нещо не е наред, остави бележка в профила. Екипът ще я види.</p>`,
  }
}

export async function deliverMail(mail: OutboundMail) {
  if (isDevMailHost()) return false
  const sender = (env as unknown as { EMAIL?: { send?: (input: unknown) => Promise<unknown> } }).EMAIL
  if (!sender?.send) return false
  try {
    await sender.send({
      to: mail.to,
      from: FROM,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    })
    return true
  } catch (error) {
    console.error('email send failed', error instanceof Error ? error.message : 'unknown')
    return false
  }
}

export function isDevMailHost() {
  try {
    const bare = getRequestHost().replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
    return bare === 'localhost' || bare === '127.0.0.1' || bare === '::1'
  } catch {
    return false
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char)
}
