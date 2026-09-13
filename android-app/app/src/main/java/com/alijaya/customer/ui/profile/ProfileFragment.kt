package com.alijaya.customer.ui.profile

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import com.alijaya.customer.CustomerApplication
import com.alijaya.customer.databinding.FragmentProfileBinding
import com.alijaya.customer.ui.login.LoginActivity
import com.alijaya.customer.ui.server.ServerConfigActivity
import com.alijaya.customer.util.AppUpdateHelper

class ProfileFragment : Fragment() {
    private var _binding: FragmentProfileBinding? = null
    private val binding get() = _binding!!

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentProfileBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        val session = CustomerApplication.sessionManager

        binding.tvCustomerName.text = session.getCustomerName()
        binding.tvCustomerPhone.text = session.getCustomerPhone()
        binding.tvServerUrl.text = "Server: " + session.getServerBaseUrl()

        binding.btnCheckUpdate.setOnClickListener {
            val act = activity ?: return@setOnClickListener
            AppUpdateHelper.checkForUpdate(act, showToastIfLatest = true)
        }

        binding.btnChangeServer.setOnClickListener {
            startActivity(Intent(context, ServerConfigActivity::class.java))
        }

        binding.btnWhatsappCs.setOnClickListener {
            val phone = "6287820851413"
            val url = "https://wa.me/" + phone + "?text=Halo%20Admin%20saya%20pelanggan%20" + Uri.encode(session.getCustomerName())
            try {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            } catch (_: Exception) {}
        }

        binding.btnLogout.setOnClickListener {
            session.logout()
            val intent = Intent(context, LoginActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            }
            startActivity(intent)
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
