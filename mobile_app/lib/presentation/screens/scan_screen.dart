import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../../app_services.dart';
import '../../data/models/product.dart';
import 'loss_form_screen.dart';

/// Permite tanto a leitura por câmera quanto a digitação manual do código de
/// barras — as duas formas de identificar o produto citadas na funcionalidade
/// 1 do documento de arquitetura.
class ScanScreen extends StatefulWidget {
  const ScanScreen({super.key});

  @override
  State<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends State<ScanScreen> {
  final MobileScannerController _controller = MobileScannerController();
  bool _isProcessing = false;
  String? _notFoundMessage;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _handleBarcode(String barcode) async {
    if (_isProcessing) return;
    setState(() {
      _isProcessing = true;
      _notFoundMessage = null;
    });

    // Busca no cache local — funciona mesmo sem internet (Seção 4 do documento).
    final Product? product = await AppServices.productRepository.findByBarcodeLocal(barcode);

    if (!mounted) return;

    if (product == null) {
      setState(() {
        _isProcessing = false;
        _notFoundMessage =
            'Nenhum produto encontrado para o código "$barcode". Peça ao gerente '
            'para cadastrá-lo no painel web, ou confira se o catálogo está '
            'atualizado (puxe para atualizar na tela inicial).';
      });
      return;
    }

    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => LossFormScreen(product: product)),
    );

    if (mounted) setState(() => _isProcessing = false);
  }

  void _showManualEntryDialog() {
    final controller = TextEditingController();
    showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Digitar código de barras'),
        content: TextField(
          controller: controller,
          keyboardType: TextInputType.number,
          autofocus: true,
          decoration: const InputDecoration(hintText: 'Ex: 7891000100103'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () {
              Navigator.pop(dialogContext);
              if (controller.text.trim().isNotEmpty) {
                _handleBarcode(controller.text.trim());
              }
            },
            child: const Text('Buscar'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Escanear produto'),
        actions: [
          IconButton(
            icon: const Icon(Icons.keyboard),
            tooltip: 'Digitar código manualmente',
            onPressed: _showManualEntryDialog,
          ),
        ],
      ),
      body: Stack(
        children: [
          MobileScanner(
            controller: _controller,
            onDetect: (capture) {
              final barcodes = capture.barcodes;
              if (barcodes.isNotEmpty && barcodes.first.rawValue != null) {
                _handleBarcode(barcodes.first.rawValue!);
              }
            },
          ),
          // Moldura visual simples para orientar o enquadramento do código.
          Center(
            child: Container(
              width: 260,
              height: 160,
              decoration: BoxDecoration(
                border: Border.all(color: Colors.white, width: 2),
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          ),
          if (_isProcessing)
            const Positioned.fill(
              child: ColoredBox(
                color: Colors.black45,
                child: Center(child: CircularProgressIndicator()),
              ),
            ),
          if (_notFoundMessage != null)
            Positioned(
              left: 16,
              right: 16,
              bottom: 24,
              child: Card(
                color: Colors.red.shade50,
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(_notFoundMessage!),
                      const SizedBox(height: 8),
                      Align(
                        alignment: Alignment.centerRight,
                        child: TextButton(
                          onPressed: () => setState(() => _notFoundMessage = null),
                          child: const Text('Entendi'),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
