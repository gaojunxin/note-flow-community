import api from './api'

export interface ManagedRole {
  roleId: number
  roleName: string
  roleKey: string
  status?: string
}

export interface ManagedUser {
  userId: number
  userName: string
  nickName: string
  email?: string
  phonenumber?: string
  sex?: string
  deptId?: number
  status: '0' | '1'
  createTime?: string
  roles?: ManagedRole[]
}

export interface ManagedUserDetail extends ManagedUser {
  roleIds: number[]
  postIds: number[]
}

export interface CreateManagedUser {
  userName: string
  nickName: string
  password: string
  email?: string
  roleIds: number[]
}

interface UserListResponse { rows?: ManagedUser[]; total?: number }
interface UserOptionsResponse { roles?: ManagedRole[] }
interface UserDetailResponse { data?: ManagedUser; roleIds?: number[]; postIds?: number[]; roles?: ManagedRole[] }

export const userAdminService = {
  async list(params: { userName?: string; pageNum?: number; pageSize?: number } = {}) {
    const { data } = await api.get<UserListResponse>('/system/user/list', { params: { pageNum: 1, pageSize: 100, ...params } })
    return { rows: data.rows ?? [], total: data.total ?? 0 }
  },
  async roles() {
    const { data } = await api.get<UserOptionsResponse>('/system/user/')
    return (data.roles ?? []).filter(role => role.status !== '1')
  },
  async detail(userId: number) {
    const { data } = await api.get<UserDetailResponse>(`/system/user/${userId}`)
    if (!data.data) throw new Error('服务器未返回用户详情')
    return {
      user: { ...data.data, roleIds: data.roleIds ?? [], postIds: data.postIds ?? [] } as ManagedUserDetail,
      roles: (data.roles ?? []).filter(role => role.status !== '1')
    }
  },
  async create(input: CreateManagedUser) {
    await api.post('/system/user', { ...input, status: '0', sex: '2', postIds: [] })
  },
  async changeStatus(userId: number, status: '0' | '1') {
    await api.put('/system/user/changeStatus', { userId, status })
  },
  async update(input: ManagedUserDetail) {
    await api.put('/system/user', {
      userId: input.userId,
      userName: input.userName,
      nickName: input.nickName,
      email: input.email || '',
      phonenumber: input.phonenumber || '',
      sex: input.sex || '2',
      status: input.status,
      deptId: input.deptId,
      roleIds: input.roleIds,
      postIds: input.postIds
    })
  },
  async resetPassword(userId: number, password: string) {
    await api.put('/system/user/resetPwd', { userId, password })
  }
}
