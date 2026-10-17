# Quickstart Verification: 配送依頼連携

1. 同じ冪等キーで配送依頼を2回登録し、同じ依頼IDが返り、DBの依頼が1件であることを確認する。
2. acceptedからshippingへ更新し、Outboxに状態イベントが1件保存されることを確認する。
3. deliveredからcancelledを要求し、エラーとなり状態がdeliveredのままであることを確認する。
4. 通知を3回失敗させ、イベントがisolatedになり5分以内に通知されることを確認する。
5. 原因解消後に手動再送し、元と同じイベントIDで成功してresolvedになることを確認する。
