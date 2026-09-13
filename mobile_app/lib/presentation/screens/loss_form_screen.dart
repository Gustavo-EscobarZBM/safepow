import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../../app_services.dart';
import '../../data/models/auth_session.dart';
import '../../data/models/loss_location.dart';
import '../../data/models/loss_reason.dart';
import '../../data/models/product.dart';

class LossFormScreen extends StatefulWidget {
  final Product product;
  const LossFormScreen({super.key, required this.product});

  @override
  State<LossFormScreen> createState() => _LossFormScreenState();
}

class _LossFormScreenState extends State<LossFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _quantityController = TextEditingController(text: '1');
  final _descriptionController = TextEditingController();
  XFile? _pickedImage;
  bool _isSaving = false;

  bool _catalogsLoading = true;
  List<LossReason> _reasons = [];
  List<LossLocation> _locations = [];
  String? _selectedReasonId;
  String? _selectedLocationId;

  @override
  void initState() {
    super.initState();
    _loadCatalogs();
  }

  // Motivo e local vêm do catálogo cadastrado pelo gerente (Cadastros >
  // Motivo/Local da Perda) — o backend exige o UUID de um item já
  // cadastrado, não texto livre. O cache local é baixado logo após o login
  // (Seção 4.3 do documento), então isto normalmente só lê o SQLite.
  Future<void> _loadCatalogs() async {
    final reasons = await AppServices.lossReasonRepository.findAllLocal();
    final locations = await AppServices.lossLocationRepository.findAllLocal();
    if (!mounted) return;
    setState(() {
      _reasons = reasons;
      _locations = locations;
      _catalogsLoading = false;
    });
  }

  Future<void> _pickImage() async {
    final picker = ImagePicker();
    // Comprime a imagem antes de guardar — reduz o custo de armazenamento e
    // de envio pela rede (relevante no cenário de conexão instável do estoque,
    // Seção 4 do documento).
    final image = await picker.pickImage(
      source: ImageSource.camera,
      maxWidth: 1280,
      imageQuality: 70,
    );
    if (image != null) setState(() => _pickedImage = image);
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _isSaving = true);

    final reason = _reasons.firstWhere((r) => r.id == _selectedReasonId);
    final location = _locations.firstWhere((l) => l.id == _selectedLocationId);

    // Grava localmente primeiro (experiência instantânea, independe de rede
    // — Seção 4.1) e só depois tenta sincronizar em segundo plano.
    await AppServices.lossRepository.registerLossLocally(
      productId: widget.product.id,
      productName: widget.product.name,
      quantity: double.tryParse(_quantityController.text.replaceAll(',', '.')) ?? 1,
      locationId: location.id,
      locationName: location.name,
      reasonId: reason.id,
      reasonName: reason.name,
      description: _descriptionController.text.trim(),
      localImagePath: _pickedImage?.path,
    );

    // Dispara uma tentativa imediata (não bloqueia a UI se não houver rede —
    // o SyncQueueService trata isso internamente).
    AppServices.syncQueueService.trySyncPending();

    if (!mounted) return;

    // Lido do AuthSession (capturado no login, spec seção 5) — não é uma
    // chamada de rede, por isso o aviso aparece mesmo offline, no mesmo
    // momento "otimista" que o resto do registro local já usa.
    final AuthSession? session = await AppServices.authRepository.currentSession();
    if (session != null && session.lossVerificationEnabled) {
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Perda registrada'),
          content: const Text(
            'Esta empresa exige conferência de descarte. O registro foi encaminhado para o conferente confirmar.',
          ),
          actions: [
            TextButton(
              onPressed: () {
                Navigator.of(dialogContext).pop();
                Navigator.of(context).popUntil((route) => route.isFirst);
              },
              child: const Text('Voltar à tela inicial'),
            ),
            FilledButton(
              onPressed: () {
                Navigator.of(dialogContext).pop();
                Navigator.of(context).pop(); // fecha o formulário, volta pro Scan
              },
              child: const Text('Registrar nova perda'),
            ),
          ],
        ),
      );
      return;
    }

    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Perda registrada. Será sincronizada automaticamente.')),
    );
    Navigator.of(context)
      ..pop() // fecha o formulário
      ..pop(); // volta para a tela inicial
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Registrar perda')),
      body: _catalogsLoading
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Card(
                      child: ListTile(
                        leading: const Icon(Icons.inventory_2_outlined),
                        title: Text(widget.product.name),
                        subtitle: Text('Código: ${widget.product.barcode}'),
                      ),
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _quantityController,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration:
                          const InputDecoration(labelText: 'Quantidade', border: OutlineInputBorder()),
                      validator: (value) {
                        final parsed = double.tryParse((value ?? '').replaceAll(',', '.'));
                        if (parsed == null || parsed <= 0) return 'Informe uma quantidade válida';
                        return null;
                      },
                    ),
                    const SizedBox(height: 16),
                    DropdownButtonFormField<String>(
                      initialValue: _selectedReasonId,
                      decoration: const InputDecoration(
                        labelText: 'Motivo da perda',
                        border: OutlineInputBorder(),
                      ),
                      items: _reasons
                          .map((r) => DropdownMenuItem(value: r.id, child: Text(r.name)))
                          .toList(),
                      onChanged: (value) => setState(() => _selectedReasonId = value),
                      validator: (value) => value == null ? 'Selecione o motivo' : null,
                    ),
                    const SizedBox(height: 16),
                    DropdownButtonFormField<String>(
                      initialValue: _selectedLocationId,
                      decoration: const InputDecoration(
                        labelText: 'Local da ocorrência',
                        border: OutlineInputBorder(),
                      ),
                      items: _locations
                          .map((l) => DropdownMenuItem(value: l.id, child: Text(l.name)))
                          .toList(),
                      onChanged: (value) => setState(() => _selectedLocationId = value),
                      validator: (value) => value == null ? 'Selecione o local' : null,
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _descriptionController,
                      maxLines: 4,
                      decoration: const InputDecoration(
                        labelText: 'O que aconteceu? (opcional)',
                        hintText: 'Descreva a perda (ex: produto vencido, caiu e quebrou, avariado no transporte...)',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 16),
                    if (_pickedImage != null)
                      ClipRRect(
                        borderRadius: BorderRadius.circular(8),
                        child: Image.file(File(_pickedImage!.path), height: 180, fit: BoxFit.cover),
                      ),
                    OutlinedButton.icon(
                      onPressed: _pickImage,
                      icon: const Icon(Icons.camera_alt_outlined),
                      label: Text(_pickedImage == null ? 'Adicionar foto (opcional)' : 'Trocar foto'),
                    ),
                    const SizedBox(height: 24),
                    FilledButton(
                      onPressed: _isSaving ? null : _submit,
                      child: _isSaving
                          ? const SizedBox(
                              height: 20,
                              width: 20,
                              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                            )
                          : const Text('Salvar registro'),
                    ),
                  ],
                ),
              ),
            ),
    );
  }
}
