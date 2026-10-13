import { create } from 'zustand'

/** Promise-based modal dialogs, rendered by <DialogHost/>. */

export type DialogRequest =
  | {
      kind: 'prompt'
      title: string
      label: string
      initial: string
      confirmLabel: string
      resolve: (value: string | null) => void
    }
  | {
      kind: 'confirm'
      title: string
      message: string
      confirmLabel: string
      danger: boolean
      resolve: (ok: boolean) => void
    }
  | {
      kind: 'choose'
      title: string
      label: string
      options: { value: string; label: string }[]
      resolve: (value: string | null) => void
    }
  | {
      kind: 'icon'
      title: string
      current: string | undefined
      /** Icon name, null to remove, undefined when cancelled. */
      resolve: (icon: string | null | undefined) => void
    }

export const useDialog = create<{ current: DialogRequest | null }>(() => ({ current: null }))

function open<T>(make: (resolve: (v: T) => void) => DialogRequest): Promise<T> {
  return new Promise<T>((resolve) => {
    useDialog.setState({
      current: make((v) => {
        useDialog.setState({ current: null })
        resolve(v)
      }),
    })
  })
}

export function promptDialog(opts: {
  title: string
  label: string
  initial?: string
  confirmLabel?: string
}) {
  return open<string | null>((resolve) => ({
    kind: 'prompt',
    title: opts.title,
    label: opts.label,
    initial: opts.initial ?? '',
    confirmLabel: opts.confirmLabel ?? 'OK',
    resolve,
  }))
}

export function confirmDialog(opts: {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
}) {
  return open<boolean>((resolve) => ({
    kind: 'confirm',
    title: opts.title,
    message: opts.message,
    confirmLabel: opts.confirmLabel ?? 'OK',
    danger: opts.danger ?? false,
    resolve,
  }))
}

export function iconDialog(opts: { title: string; current: string | undefined }) {
  return open<string | null | undefined>((resolve) => ({
    kind: 'icon',
    title: opts.title,
    current: opts.current,
    resolve,
  }))
}

export function chooseDialog(opts: {
  title: string
  label: string
  options: { value: string; label: string }[]
}) {
  return open<string | null>((resolve) => ({ kind: 'choose', ...opts, resolve }))
}
