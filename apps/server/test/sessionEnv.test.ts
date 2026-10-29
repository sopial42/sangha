import { describe, expect, it } from 'vitest'
import { envText, parseEnvText } from '@sangha/shared'
import { checkSessionEnv } from '../src/sessionEnv'

describe('session env', () => {
  it('reads a pasted .env: export, quotes, comments and blank lines', () => {
    const { env, errors } = parseEnvText('# OVH\nexport OS_CLOUD=poc-axel\n\nKUBECONFIG="/Users/a/kube config"\nTOKEN=\'a=b\'\nEMPTY=\n')
    expect(errors).toEqual([])
    expect(env).toEqual({ OS_CLOUD: 'poc-axel', KUBECONFIG: '/Users/a/kube config', TOKEN: 'a=b', EMPTY: '' })
  })

  it('names the line that is not KEY=value', () => {
    expect(parseEnvText('A=1\nnimporte quoi\n').errors).toEqual(['ligne 2 : « nimporte quoi » n\'est pas de la forme CLÉ=valeur'])
  })

  it('writes it back so it reads the same', () => {
    const env = { A: '1', B: 'avec espace', C: 'x#y' }
    expect(parseEnvText(envText(env)).env).toEqual(env)
  })

  it('keeps what Sangha needs out of reach', () => {
    expect(checkSessionEnv({ OS_CLOUD: 'x' })).toEqual({ OS_CLOUD: 'x' })
    expect(() => checkSessionEnv({ ANTHROPIC_API_KEY: 'sk' })).toThrow('réservée')
    expect(() => checkSessionEnv({ GIT_CONFIG_GLOBAL: '/x' })).toThrow('réservée')
    expect(() => checkSessionEnv({ 'BAD-NAME': 'x' })).toThrow('invalide')
    expect(() => checkSessionEnv({ A: 1 })).toThrow('texte')
  })
})
