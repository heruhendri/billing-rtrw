package com.alijaya.customer.ui.home

import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.cardview.widget.CardView
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.alijaya.customer.CustomerApplication
import com.alijaya.customer.R
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.text.NumberFormat
import java.util.Locale
import java.util.concurrent.TimeUnit

class CustomerPpobFragment : Fragment() {
    private fun httpClient() = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).build()
    private fun getBaseUrl(): String { val b = CustomerApplication.sessionManager.getServerBaseUrl(); return if (b.endsWith("/")) b.dropLast(1) else b }
    private fun getToken(): String = CustomerApplication.sessionManager.getAuthToken()
    private val fmt = NumberFormat.getCurrencyInstance(Locale("id", "ID"))

    private var currentBalance: Double = 0.0
    private var allCatalog = mutableListOf<JSONObject>()
    private lateinit var tvBalance: TextView
    private lateinit var etPhone: EditText
    private lateinit var tvProvider: TextView
    private lateinit var productsContainer: LinearLayout

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        val swipe = SwipeRefreshLayout(requireContext()).apply { setBackgroundColor(Color.parseColor("#0F172A")) }
        val scroll = android.widget.ScrollView(requireContext())
        val content = LinearLayout(requireContext()).apply { orientation = LinearLayout.VERTICAL; setPadding(32, 32, 32, 32) }
        scroll.addView(content); swipe.addView(scroll)
        buildUI(content)
        loadData(swipe)
        swipe.setOnRefreshListener { loadData(swipe) }
        return swipe
    }

    private fun buildUI(container: LinearLayout) {
        val ctx = requireContext()
        container.addView(TextView(ctx).apply { text = "📱 Beli Pulsa, Data & Token PLN"; setTextColor(Color.WHITE); textSize = 18f; typeface = Typeface.DEFAULT_BOLD; setPadding(0, 0, 0, 4) })

        // Balance Card
        val balCard = CardView(ctx).apply { radius = 24f; setCardBackgroundColor(Color.parseColor("#132742")); cardElevation = 4f; layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { setMargins(0, 0, 0, 16) } }
        val balInner = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; setPadding(24, 20, 24, 20); gravity = Gravity.CENTER_VERTICAL }
        val balCol = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f) }
        balCol.addView(TextView(ctx).apply { text = "Saldo Dompet Anda"; setTextColor(Color.parseColor("#38BDF8")); textSize = 11.5f; typeface = Typeface.DEFAULT_BOLD })
        tvBalance = TextView(ctx).apply { text = "Rp 0"; setTextColor(Color.WHITE); textSize = 20f; typeface = Typeface.DEFAULT_BOLD; setPadding(0, 4, 0, 0) }
        balCol.addView(tvBalance)
        balInner.addView(balCol)

        val btnTopup = Button(ctx).apply {
            text = "➕ Isi Saldo"; setBackgroundColor(Color.parseColor("#2563EB")); setTextColor(Color.WHITE); textSize = 11.5f; typeface = Typeface.DEFAULT_BOLD
            setOnClickListener {
                parentFragmentManager.beginTransaction()
                    .replace(R.id.fragment_container, CustomerTopupFragment())
                    .addToBackStack(null).commit()
            }
        }
        balInner.addView(btnTopup)
        balCard.addView(balInner)
        container.addView(balCard)

        // Input Card
        val inputCard = CardView(ctx).apply { radius = 24f; setCardBackgroundColor(Color.parseColor("#1E293B")); cardElevation = 4f; layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { setMargins(0, 0, 0, 16) } }
        val inputInner = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; setPadding(24, 20, 24, 20) }

        val rowLabel = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        rowLabel.addView(TextView(ctx).apply { text = "NOMOR TUJUAN / HP"; setTextColor(Color.parseColor("#38BDF8")); textSize = 11.5f; typeface = Typeface.DEFAULT_BOLD; layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f) })
        tvProvider = TextView(ctx).apply { text = "Pilih Operator"; setTextColor(Color.parseColor("#4ADE80")); textSize = 11.5f; typeface = Typeface.DEFAULT_BOLD }
        rowLabel.addView(tvProvider)
        inputInner.addView(rowLabel)

        etPhone = EditText(ctx).apply {
            hint = "08xxxxxxxxxx"; setTextColor(Color.WHITE); setHintTextColor(Color.parseColor("#64748B")); textSize = 18f; typeface = Typeface.DEFAULT_BOLD
            background = ContextCompat.getDrawable(ctx, R.drawable.bg_input_field); setPadding(24, 20, 24, 20)
            inputType = android.text.InputType.TYPE_CLASS_PHONE
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { setMargins(0, 8, 0, 4) }
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                    val p = detectProvider(s.toString().trim())
                    tvProvider.text = if (p.isNotEmpty()) "📡 $p" else "Deteksi Otomatis..."
                    filterProducts(p)
                }
                override fun afterTextChanged(s: Editable?) {}
            })
        }
        inputInner.addView(etPhone)
        inputCard.addView(inputInner)
        container.addView(inputCard)

        // Products Container
        container.addView(TextView(ctx).apply { text = "PILIH NOMINAL PRODUK"; setTextColor(Color.parseColor("#94A3B8")); textSize = 11.5f; typeface = Typeface.DEFAULT_BOLD; setPadding(0, 8, 0, 8) })
        productsContainer = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        container.addView(productsContainer)
    }

    private fun detectProvider(phone: String): String {
        val clean = phone.replace("+62", "0").replace("-", "").trim()
        if (clean.length < 4) return ""
        val prefix = clean.take(4)
        return when (prefix) {
            "0811", "0812", "0813", "0821", "0822", "0823", "0851", "0852", "0853" -> "Telkomsel"
            "0814", "0815", "0816", "0855", "0856", "0857", "0858" -> "Indosat"
            "0817", "0818", "0819", "0859", "0877", "0878" -> "XL"
            "0831", "0832", "0833", "0838" -> "Axis"
            "0895", "0896", "0897", "0898", "0899" -> "Tri"
            "0881", "0882", "0883", "0884", "0885", "0886", "0887", "0888", "0889" -> "Smartfren"
            else -> ""
        }
    }

    private fun loadData(swipe: SwipeRefreshLayout) {
        swipe.isRefreshing = true
        lifecycleScope.launch {
            val (balJson, catJson) = withContext(Dispatchers.IO) {
                val b = try {
                    val req = Request.Builder().url("${getBaseUrl()}/api/customer/app/customer/wallet").addHeader("Authorization", "Bearer ${getToken()}").build()
                    val resp = httpClient().newCall(req).execute()
                    if (resp.isSuccessful) resp.body?.string()?.let { JSONObject(it) } else null
                } catch (_: Exception) { null }
                val c = try {
                    val req = Request.Builder().url("${getBaseUrl()}/api/customer/app/customer/ppob/catalog").addHeader("Authorization", "Bearer ${getToken()}").build()
                    val resp = httpClient().newCall(req).execute()
                    if (resp.isSuccessful) resp.body?.string()?.let { JSONObject(it) } else null
                } catch (_: Exception) { null }
                Pair(b, c)
            }
            swipe.isRefreshing = false

            currentBalance = balJson?.optJSONObject("data")?.optDouble("balance", 0.0) ?: 0.0
            tvBalance.text = fmt.format(currentBalance)

            val arr = catJson?.optJSONArray("data") ?: JSONArray()
            allCatalog.clear()
            for (i in 0 until arr.length()) allCatalog.add(arr.getJSONObject(i))

            filterProducts(detectProvider(etPhone.text.toString().trim()))
        }
    }

    private fun filterProducts(provider: String) {
        val ctx = context ?: return
        productsContainer.removeAllViews()

        val filtered = if (provider.isNotEmpty()) {
            allCatalog.filter { it.optString("brand", "").contains(provider, ignoreCase = true) }
        } else {
            allCatalog.take(15)
        }

        if (filtered.isEmpty()) {
            productsContainer.addView(TextView(ctx).apply {
                text = if (provider.isNotEmpty()) "Belum ada produk untuk operator $provider" else "Ketik nomor telepon untuk menampilkan pilihan nominal pulsa"
                setTextColor(Color.parseColor("#94A3B8")); textSize = 13f; gravity = Gravity.CENTER; setPadding(0, 40, 0, 40)
            })
            return
        }

        for (item in filtered) {
            val price = item.optDouble("price_sell", item.optDouble("price", 0.0))
            val card = CardView(ctx).apply {
                radius = 20f; setCardBackgroundColor(Color.parseColor("#1E293B")); cardElevation = 3f
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { setMargins(0, 0, 0, 10) }
                isClickable = true; isFocusable = true
            }
            val inner = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; setPadding(20, 16, 20, 16); gravity = Gravity.CENTER_VERTICAL }
            val col = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f) }
            col.addView(TextView(ctx).apply { text = item.optString("product_name", "-"); setTextColor(Color.WHITE); textSize = 13.5f; typeface = Typeface.DEFAULT_BOLD })
            col.addView(TextView(ctx).apply { text = "${item.optString("category", "Pulsa")} • ${item.optString("brand", "-")}"; setTextColor(Color.parseColor("#94A3B8")); textSize = 11f })
            inner.addView(col)
            inner.addView(TextView(ctx).apply { text = fmt.format(price); setTextColor(Color.parseColor("#4ADE80")); textSize = 14f; typeface = Typeface.DEFAULT_BOLD })
            card.addView(inner)
            card.setOnClickListener { confirmPurchase(item) }
            productsContainer.addView(card)
        }
    }

    private fun confirmPurchase(item: JSONObject) {
        val ctx = context ?: return
        val target = etPhone.text.toString().trim()
        if (target.length < 9) { Toast.makeText(ctx, "Masukkan nomor telepon tujuan yang valid terlebih dahulu", Toast.LENGTH_SHORT).show(); return }

        val prodName = item.optString("product_name")
        val sku = item.optString("sku")
        val price = item.optDouble("price_sell", item.optDouble("price", 0.0))

        AlertDialog.Builder(ctx)
            .setTitle("Konfirmasi Pembelian")
            .setMessage("Beli $prodName\nNomor: $target\nHarga: ${fmt.format(price)}\n\nSaldo Anda saat ini: ${fmt.format(currentBalance)}")
            .setPositiveButton("Beli Sekarang") { _, _ ->
                doPurchase(sku, target)
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun doPurchase(sku: String, target: String) {
        val ctx = context ?: return
        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) {
                try {
                    val body = JSONObject().put("sku", sku).put("target", target).toString().toRequestBody("application/json".toMediaType())
                    val req = Request.Builder().url("${getBaseUrl()}/api/customer/app/customer/ppob/order")
                        .addHeader("Authorization", "Bearer ${getToken()}").post(body).build()
                    val resp = httpClient().newCall(req).execute()
                    resp.body?.string()?.let { JSONObject(it) }
                } catch (_: Exception) { null }
            }

            if (result?.optBoolean("success") == true) {
                Toast.makeText(ctx, "✅ ${result.optString("message")}", Toast.LENGTH_LONG).show()
                val remBal = result.optJSONObject("data")?.optDouble("remainingBalance", currentBalance) ?: currentBalance
                currentBalance = remBal
                tvBalance.text = fmt.format(currentBalance)
            } else {
                Toast.makeText(ctx, "❌ ${result?.optString("message") ?: "Gagal memproses transaksi"}", Toast.LENGTH_LONG).show()
            }
        }
    }
}
