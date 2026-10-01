"""Streamlit アプリに潮流推算ビューアを埋め込む例。

既存の Streamlit アプリ（社内のスタッフクイズなど）に、このページを
そのまま差し込んで使うためのもの。潮流ビューア側に手を入れる必要はない。

    streamlit run examples/streamlit_embed.py

注意している点は以下の3つ。
"""

import streamlit as st
import streamlit.components.v1 as components

# 埋め込む潮流ビューアの URL（Render のもの）に書き換える
TIDAL_URL = "https://tidalstream-xxxx.onrender.com"

# 【1】必ず wide にする。
# 潮流ビューアは幅 900px 未満だと図を縦1列に積む作りなので、Streamlit の
# 既定幅（730px ほど）のままだと3枚が縦に並び、とても縦長になってしまう。
# wide なら横一列のまま収まる。
st.set_page_config(page_title="スタッフクイズ", layout="wide")

st.title("スタッフクイズ")

# …ここに既存のクイズの中身…

st.header("東京湾の潮流")

# 【2】高さは固定値で渡す。
# iframe の中身の高さは外から測れないので、Streamlit 側で決め打ちになる。
# 900px あれば「3枚の図＋選んだ地点のグラフ」がだいたい収まる。
# 図だけでよければ 650 くらいまで下げてよい。
components.iframe(TIDAL_URL, height=900, scrolling=True)

# 【3】初回表示が遅いことがある。
# Render の無料枠は、しばらく使われないとサーバが眠る。眠ったあとの最初の
# 1回だけ起き上がりに 30〜60 秒ほどかかり、その間 iframe は白いままになる。
# 止まったように見えるので、ひとこと添えておくと問い合わせが減る。
st.caption(
    "※ しばらく使われていないと、最初の表示に 30 秒ほどかかることがあります。"
    "白いままのときは少し待ってください。"
)

st.caption(
    "出典:「潮流推算」（海上保安庁 海洋情報部ホームページ） "
    "https://www1.kaiho.mlit.go.jp/TIDE/pred2/cgi-bin/CurrPredCgi_K.cgi?area=01"
)
