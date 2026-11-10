import {describe,expect,it,vi} from 'vitest'
import {createCommunityBackHandler} from '../src/community/backNavigation'
function actions() {return {dismissDialog:vi.fn(()=>false),saveDraft:vi.fn(async()=>{}),navigateBack:vi.fn(()=>false),close:vi.fn(async()=>{})}}
describe('native back persistence guard',()=>{
 it('awaits saving before navigation or close and ignores repeated presses',async()=>{
  const a=actions();let resume!:()=>void;a.saveDraft.mockImplementation(()=>new Promise(resolve=>{resume=resolve}))
  const back=createCommunityBackHandler(a),first=back();await back()
  expect(a.saveDraft).toHaveBeenCalledTimes(1);expect(a.navigateBack).not.toHaveBeenCalled();expect(a.close).not.toHaveBeenCalled()
  resume();await first;expect(a.close).toHaveBeenCalledTimes(1)
 })
 it('preserves the editor on failed save and permits a later retry',async()=>{
  const a=actions();a.saveDraft.mockRejectedValueOnce(Error('revision conflict'));const back=createCommunityBackHandler(a)
  await expect(back()).rejects.toThrow('revision conflict');expect(a.navigateBack).not.toHaveBeenCalled();expect(a.close).not.toHaveBeenCalled()
  await back();expect(a.close).toHaveBeenCalledTimes(1)
 })
 it('dismisses destructive dialogs and navigates within the app before exiting',async()=>{
  const a=actions();a.dismissDialog.mockReturnValueOnce(true);a.navigateBack.mockReturnValueOnce(true);const back=createCommunityBackHandler(a)
  await back();expect(a.saveDraft).not.toHaveBeenCalled()
  await back();expect(a.saveDraft).toHaveBeenCalledTimes(1);expect(a.close).not.toHaveBeenCalled()
  await back();expect(a.close).toHaveBeenCalledTimes(1)
 })
})
